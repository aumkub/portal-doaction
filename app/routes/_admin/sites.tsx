import { useEffect, useState } from "react";
import { Form, Link, useLoaderData, useRevalidator, useSearchParams } from "react-router";
import { backupIssues } from "~/lib/agent/backup-health";
import { pendingUpdates as offeredUpdates } from "~/lib/agent/update-level";
import type { Route } from "./+types/sites";
import { requireAdmin, requireCoAdminOrAdmin } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";
import { ONLINE_WINDOW_S, SILENT_AFTER_S, SiteCard, type ConnectedSite } from "~/components/admin/connected-sites";
import { CARE_PAUSED_KEY, lastWake, nextNightWindow, queueJobs, wakeSite, type JobRequest, type WakeRecord } from "~/lib/agent/jobs.server";
import { InventorySchema } from "~/lib/agent/inventory";
import { clientSupportExpired } from "~/lib/contract";
import { ConfirmButton } from "~/components/ui/confirm-button";

export function meta() {
  return [{ title: "เว็บไซต์ — Admin" }];
}

type SiteWithClient = ConnectedSite & { client: { id: string; name: string }; internal: boolean; expired: boolean };

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const user = await requireCoAdminOrAdmin(request, env.DB, env.SESSIONPORTAL);
  const db = createDB(env.DB);
  let rows = await db.listAllSitesWithInventory();
  // Co-admins see only the clients assigned to them, read-only.
  if (user.role !== "admin") {
    const assigned = new Set((await db.listCoAdminClients(user.id)).map((a) => a.client_id));
    rows = rows.filter((r) => assigned.has(r.client_id));
  }
  const sites: SiteWithClient[] = rows.map(
    ({ secret_enc: _s, inventory_json, client_id, client_company, client_kind, client_contract_end, ...row }) => {
      let inventory = null;
      try { inventory = inventory_json ? JSON.parse(inventory_json) : null; } catch { inventory = null; }
      return {
        ...row, inventory, client: { id: client_id, name: client_company }, internal: client_kind === "internal",
        expired: clientSupportExpired({ kind: client_kind, contract_end: client_contract_end }),
      };
    },
  );
  const now = Math.floor(Date.now() / 1000);
  const jobs = await db.listSiteJobs({ site_ids: sites.map((x) => x.id), since: now - 30 * 86400, limit: 300 });
  const paused = Boolean(await env.SESSIONPORTAL.get(CARE_PAUSED_KEY));
  const waiting = [...new Set(jobs.filter((j) => j.status === "queued" && j.not_before <= now).map((j) => j.site_id))];
  const wakes = Object.fromEntries(await Promise.all(waiting.map(async (id) => [id, await lastWake(env, id)] as const)));
  // Clients and in-house records with no connected site yet (plugin not installed or paired).
  let unconnected = (
    await env.DB.prepare(
      `SELECT c.id, c.company_name, c.website_url, c.kind, c.contract_end FROM clients c
       WHERE c.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM sites s WHERE s.client_id = c.id AND s.revoked_at IS NULL)
       ORDER BY c.kind DESC, c.company_name`
    ).all<{ id: string; company_name: string; website_url: string | null; kind: string; contract_end: string | null }>()
  ).results;
  if (user.role !== "admin") {
    const assigned = new Set((await db.listCoAdminClients(user.id)).map((a) => a.client_id));
    unconnected = unconnected.filter((c) => assigned.has(c.id));
  }
  return {
    sites, jobs, paused, now, wakes, canManage: user.role === "admin",
    unconnected: unconnected.map((c) => ({ ...c, expired: clientSupportExpired(c) })),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  // Remote updates, the fleet-wide stop switch and wakes are admin-only.
  const user = await requireAdmin(request, env.DB, env.SESSIONPORTAL);
  const db = createDB(env.DB);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "care_pause") {
    await env.SESSIONPORTAL.put(CARE_PAUSED_KEY, JSON.stringify({ by: user.id, at: Date.now() }));
    const cancelled = await db.cancelAllQueuedSiteJobs();
    return { ok: `หยุดทั้งหมดแล้ว ยกเลิกงานที่รออยู่ ${cancelled} รายการ (งานที่กำลังทำอยู่จะทำต่อจนจบและ rollback ถ้าพัง)` };
  }
  if (intent === "care_resume") {
    await env.SESSIONPORTAL.delete(CARE_PAUSED_KEY);
    return { ok: "เปิดการอัปเดตจากระยะไกลแล้ว" };
  }
  if (intent === "job_cancel") {
    await db.cancelSiteJob(String(form.get("job_id") ?? ""));
    return { ok: "ยกเลิกแล้ว" };
  }
  if (intent === "site_refresh") {
    const site = await db.getSiteById(String(form.get("site_id") ?? ""));
    if (!site || site.revoked_at) return { error: "ไม่พบเว็บไซต์" };
    // Each wake makes the client server do work; at most one per site per minute.
    const rlKey = `wake-rl:${site.id}`;
    if (await env.SESSIONPORTAL.get(rlKey)) return { error: "เพิ่งขอไป รอ 1 นาทีแล้วลองใหม่" };
    await env.SESSIONPORTAL.put(rlKey, "1", { expirationTtl: 60 });
    const invRow = await env.DB.prepare("SELECT json FROM site_inventory WHERE site_id = ?").bind(site.id).first<{ json: string }>();
    const home = invRow ? (JSON.parse(invRow.json) as { home_url?: string }).home_url : site.site_url;
    const ok = await wakeSite(env, site, home ?? site.site_url);
    return ok ? { ok: "ขอข้อมูลใหม่แล้ว รอสักครู่แล้วรีเฟรชหน้า" } : { error: "ติดต่อเว็บไม่ได้" };
  }
  if (intent === "jobs_queue") {
    if (await env.SESSIONPORTAL.get(CARE_PAUSED_KEY)) return { error: "ระบบถูกหยุดอยู่ กด “เปิดการอัปเดต” ก่อน" };
    const siteId = String(form.get("site_id") ?? "");
    const site = await db.getSiteById(siteId);
    if (!site || site.revoked_at) return { error: "ไม่พบเว็บไซต์" };
    if (!site.last_seen_at || Math.floor(Date.now() / 1000) - site.last_seen_at > SILENT_AFTER_S) {
      return { error: "เว็บนี้ขาดการติดต่อเกิน 3 ชม. ยังสั่งอัปเดตไม่ได้" };
    }
    const invRow = await env.DB.prepare("SELECT json FROM site_inventory WHERE site_id = ?").bind(siteId).first<{ json: string }>();
    const inv = invRow ? InventorySchema.safeParse(JSON.parse(invRow.json)) : null;
    if (!inv?.success) return { error: "ยังไม่มีข้อมูลเว็บไซต์" };
    if (!inv.data.file_mods_allowed) return { error: "เว็บนี้ปิดการแก้ไขไฟล์ อัปเดตจากระยะไกลไม่ได้" };
    const owner = await db.getClientById(site.client_id);
    if (owner && clientSupportExpired(owner)) return { error: "สัญญาดูแลของลูกค้ารายนี้หมดอายุแล้ว — ต่ออายุก่อนจึงอัปเดตได้" };
    const items: JobRequest[] = form.getAll("item").flatMap((v) => {
      const [kind, ...rest] = String(v).split(":");
      const slug = rest.join(":");
      return (kind === "plugin" || kind === "theme" || kind === "core") && slug ? [{ kind, slug }] : [];
    });
    const now = Math.floor(Date.now() / 1000);
    const night = form.get("window") === "night";
    const queued = await queueJobs({
      env, siteId, inventory: inv.data, items, userId: user.id, notBefore: night ? nextNightWindow(now) : 0,
    });
    if (queued === 0) return { error: "ไม่มีรายการที่อัปเดตได้ (อาจอยู่ในคิวแล้ว)" };
    if (!night) context.cloudflare.ctx.waitUntil(wakeSite(env, site, inv.data.home_url));
    return { ok: night ? `ตั้งเวลา ${queued} รายการ ทำช่วง 01:00–05:00` : `เริ่มอัปเดต ${queued} รายการ` };
  }
  return { error: "unknown intent" };
}

type Filter = "all" | "updates" | "major" | "silent" | "backup" | "internal";
const FILTERS: Filter[] = ["all", "updates", "major", "silent", "backup", "internal"];

function pendingUpdates(site: ConnectedSite) {
  const inv = site.inventory;
  if (!inv) return 0;
  return (
    (inv.core_update ? 1 : 0) +
    inv.plugins.filter((p) => p.update_version).length +
    inv.themes.filter((t) => t.update_version).length
  );
}

function ago(seconds: number): string {
  if (seconds < 3600) return `${Math.max(1, Math.floor(seconds / 60))} นาที`;
  if (seconds < 172800) return `${Math.floor(seconds / 3600)} ชม.`;
  return `${Math.floor(seconds / 86400)} วัน`;
}

/** One compact line per site; the full card opens inline on click. */
type SiteActivity = { running: string | null; queued: number; done: number };

function Spinner() {
  return <span className="inline-block h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-ink/20 border-t-ink" aria-hidden="true" />;
}

function SiteRow({ site, now, activity, wake, oldestQueued, open, onToggle, children }: {
  site: SiteWithClient; now: number; activity: SiteActivity | null; wake: WakeRecord | null; oldestQueued: number;
  open: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  const working = Boolean(activity && (activity.running || activity.queued));
  // Queued for a while with nothing running: say why, so nobody waits blind.
  const stalled = Boolean(activity && !activity.running && activity.queued && now - oldestQueued > 180);
  const stallText = !stalled
    ? null
    : wake && !wake.ok
      ? `เว็บยังไม่มารับงาน — ปลุกไม่สำเร็จ (${wake.detail}) จะเริ่มในรอบส่งข้อมูลถัดไป ภายใน 1 ชม.`
      : "เว็บยังไม่มารับงาน — จะเริ่มในรอบส่งข้อมูลถัดไป ภายใน 1 ชม.";
  const inv = site.inventory;
  const offered = inv ? offeredUpdates(inv) : [];
  const majors = offered.filter((u) => u.level === "major").length;
  const silentFor = site.last_seen_at ? now - site.last_seen_at : null;
  const online = silentFor !== null && silentFor < SILENT_AFTER_S;
  const backup = backupIssues(inv, now);
  const lastBackup = inv?.backup?.last_at ? now - inv.backup.last_at : null;
  return (
    <li className={`relative transition-colors ${working ? "bg-brand-yellow/15" : open ? "bg-paper/40" : ""}`}>
      {working && <span className="absolute inset-y-0 left-0 w-1 animate-pulse bg-brand-yellow" aria-hidden="true" />}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="grid w-full grid-cols-[minmax(0,1fr)_24px] items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-paper/60 md:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1.3fr)_minmax(0,0.9fr)_24px]"
      >
        <span className="flex min-w-0 items-center gap-3">
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            {working && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-yellow opacity-80" />}
            <span className={`relative h-2.5 w-2.5 rounded-full ${working ? "bg-brand-yellow-deep" : online ? "bg-emerald-500" : "bg-[#E0622A]"}`} title={working ? "กำลังอัปเดต" : online ? "ออนไลน์" : "ขาดการติดต่อ"} />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-ink">{new URL(site.site_url).host}</span>
            <span className="flex items-center gap-1.5 truncate text-xs text-muted-ink">
              {site.client.name}
              {site.internal && <span className="rounded-full bg-brand-yellow/40 px-1.5 text-[10px] font-semibold text-ink">ในเครือ</span>}
              {site.expired && <span className="rounded-full bg-[#FDE7DA] px-1.5 text-[10px] font-semibold text-[#B4541A]">หมดสัญญา</span>}
            </span>
            {/* Compact summary for phones, where the other columns are hidden. */}
            {working && (
              <span className="mt-1 flex items-center gap-1.5 text-[11px] font-semibold text-ink md:hidden">
                <Spinner /> {activity!.running ? `กำลังอัปเดต ${activity!.running}` : "รอคิวอัปเดต"}
              </span>
            )}
            <span className="mt-1 flex flex-wrap gap-1.5 text-[11px] md:hidden">
              {offered.length > 0 && <span className="text-ink-soft">อัปเดต {offered.length}</span>}
              {majors > 0 && <span className="font-semibold text-[#B4541A]">Major {majors}</span>}
              {backup.length > 0 && <span className="text-[#B4541A]">backup มีปัญหา</span>}
            </span>
          </span>
        </span>
        <span className="hidden text-xs tabular-nums text-ink-soft md:block">{site.wp_version ?? "—"} / {site.php_version?.split(".").slice(0, 2).join(".") ?? "—"}</span>
        <span className="hidden items-center gap-1.5 text-xs md:flex">
          {working ? (
            <span className="flex min-w-0 items-center gap-1.5 font-semibold text-ink">
              <Spinner />
              <span className="truncate">
                {activity!.running ? activity!.running : "รอคิว"}
                <span className="font-normal text-muted-ink"> · เหลือ {activity!.queued + (activity!.running ? 1 : 0)}{activity!.done ? ` · เสร็จ ${activity!.done}` : ""}</span>
              </span>
            </span>
          ) : offered.length === 0 ? (
            <span className="text-emerald-700">ล่าสุดแล้ว</span>
          ) : (
            <>
              <span className="tabular-nums text-ink">{offered.length} รายการ</span>
              {majors > 0 && <span className="rounded-full bg-[#FDE7DA] px-1.5 py-px text-[10px] font-bold text-[#B4541A]">MAJOR {majors}</span>}
            </>
          )}
        </span>
        <span className={`hidden truncate text-xs md:block ${backup.length ? "text-[#B4541A]" : "text-ink-soft"}`}>
          {!inv?.backup ? "—" : lastBackup === null ? "ไม่พบ backup" : `${ago(lastBackup)}ที่แล้ว`}
          {backup.includes("no_drive") && lastBackup !== null && " · ไม่ขึ้น Drive"}
          {backup.includes("failed") && " · ล้ม"}
        </span>
        <span className={`hidden text-xs md:block ${online ? "text-ink-soft" : "text-[#B4541A]"}`}>
          {silentFor === null ? "ยังไม่ส่งข้อมูล" : `${ago(silentFor)}ที่แล้ว`}
        </span>
        <span className={`text-faint-ink transition-transform ${open ? "rotate-90" : ""}`} aria-hidden="true">›</span>
      </button>
      {stallText && <p className="-mt-1 px-5 pb-2.5 pl-[42px] text-[11px] text-[#B4541A]">{stallText}</p>}
      {open && <div className="px-3 pb-4 sm:px-5">{children}</div>}
    </li>
  );
}

export default function AdminSitesPage() {
  const { sites, jobs, paused, now, wakes, canManage, unconnected } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const initial = searchParams.get("filter") as Filter | null;
  const [filter, setFilter] = useState<Filter>(initial && FILTERS.includes(initial) ? initial : "all");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const isSilent = (s: ConnectedSite) => !s.last_seen_at || now - s.last_seen_at >= SILENT_AFTER_S;
  const silent = sites.filter(isSilent);
  const needUpdates = sites.filter((s) => pendingUpdates(s) > 0);
  const totalUpdates = sites.reduce((n, s) => n + pendingUpdates(s), 0);
  const backupBad = sites.filter((x) => backupIssues(x.inventory, now).length > 0);
  const majorSites = sites.filter((x) => x.inventory && offeredUpdates(x.inventory).some((u) => u.level === "major"));
  const byFilter = filter === "major" ? majorSites : filter === "backup" ? backupBad : filter === "updates" ? needUpdates : filter === "silent" ? silent : filter === "internal" ? sites.filter((x) => x.internal) : sites;
  const q = query.trim().toLowerCase();
  const matched = q ? byFilter.filter((x) => x.site_url.toLowerCase().includes(q) || x.client.name.toLowerCase().includes(q)) : byFilter;

  // Sites with work in progress go first: running, then queued.
  const activity = new Map<string, SiteActivity>();
  for (const j of jobs) {
    if (j.status !== "running" && j.status !== "queued") continue;
    const a = activity.get(j.site_id) ?? { running: null, queued: 0, done: 0 };
    if (j.status === "running") a.running = j.name;
    else if (j.not_before <= now) a.queued++;
    activity.set(j.site_id, a);
  }
  for (const j of jobs) {
    const a = activity.get(j.site_id);
    if (a && j.finished_at && j.finished_at > now - 1800) a.done++;
  }
  const rank = (id: string) => (activity.get(id)?.running ? 0 : activity.get(id)?.queued ? 1 : 2);
  const shown = matched.slice().sort((a, b) => rank(a.id) - rank(b.id));
  const busy = [...activity.values()].some((a) => a.running || a.queued);

  // While anything is updating, refresh every 4 s so progress shows live.
  const revalidator = useRevalidator();
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => {
      if (revalidator.state === "idle" && document.visibilityState === "visible") revalidator.revalidate();
    }, 4000);
    return () => clearInterval(t);
  }, [busy, revalidator]);

  const chips: { key: Filter; label: string; count: number }[] = [
    { key: "all", label: "ทั้งหมด", count: sites.length },
    { key: "updates", label: "รออัปเดต", count: needUpdates.length },
    { key: "major", label: "มี Major", count: majorSites.length },
    { key: "silent", label: "ขาดการติดต่อ", count: silent.length },
    { key: "backup", label: "backup มีปัญหา", count: backupBad.length },
    { key: "internal", label: "เว็บในเครือ", count: sites.filter((x) => x.internal).length },
  ];

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-muted-ink">เว็บไซต์ที่ดูแล</p>
        <h1 className="mt-1.5 text-[28px] md:text-[32px] font-bold tracking-[-0.02em] text-ink">
          {sites.length === 0
            ? "ยังไม่มีเว็บไซต์ที่เชื่อมต่อ"
            : `เชื่อมต่อ ${sites.length} เว็บ · รออัปเดต ${totalUpdates} รายการ`}
        </h1>
        {silent.length > 0 && (
          <p className="mt-1 text-sm text-[#B4541A]">{silent.length} เว็บไม่ได้ส่งข้อมูลเกิน 3 ชม.</p>
        )}
      </div>

      {canManage && (
      <Form
        method="post"
        className={`flex flex-wrap items-center justify-between gap-3 rounded-[20px] border px-5 py-4 ${
          paused ? "border-[#F6D3B0] bg-[#FFF7EE]" : "border-line bg-white"
        }`}
      >
        <div className="min-w-0 text-sm">
          <p className="font-semibold text-ink">
            {paused ? "หยุดการอัปเดตจากระยะไกลทั้งหมดอยู่" : "การอัปเดตจากระยะไกล: เปิดอยู่"}
          </p>
          <p className="mt-0.5 text-xs text-muted-ink">
            {paused
              ? "เว็บไซต์จะไม่รับงานใหม่จนกว่าจะเปิดอีกครั้ง"
              : "กด “หยุดทั้งหมด” เมื่อเกิดปัญหา งานที่รอคิวจะถูกยกเลิกทันที"}
          </p>
        </div>
        {paused ? (
          <button
            name="intent" value="care_resume" type="submit"
            className="inline-flex h-9 items-center rounded-full bg-ink px-4 text-[13px] font-semibold text-white hover:bg-ink/90 transition-colors"
          >
            เปิดการอัปเดต
          </button>
        ) : (
          <ConfirmButton
            name="intent" value="care_pause" destructive confirmLabel="หยุดทั้งหมด"
            message="หยุดการอัปเดตจากระยะไกลทุกเว็บ และยกเลิกงานที่รอคิวทั้งหมด?"
            className="inline-flex h-9 items-center rounded-full border border-line bg-white px-4 text-[13px] font-semibold text-destructive hover:bg-[#FFF7EE] transition-colors"
          >
            หยุดทั้งหมด
          </ConfirmButton>
        )}
      </Form>
      )}

      {sites.length === 0 ? (
        <div className="rounded-[20px] border border-line bg-white p-6 text-sm text-ink-soft">
          เชื่อมเว็บไซต์ได้จากหน้ารายละเอียดลูกค้า → การ์ด “เว็บไซต์ที่เชื่อมต่อ” → ปุ่ม “เชื่อมเว็บไซต์”{" "}
          <Link to="/admin/clients" className="font-semibold text-ink underline underline-offset-2">ไปที่รายชื่อลูกค้า</Link>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ค้นหาเว็บหรือลูกค้า…"
              className="h-9 w-full rounded-full border border-line bg-white px-4 text-[13px] text-ink placeholder:text-faint-ink focus:outline-none focus:ring-2 focus:ring-ink/10 sm:w-56"
            />
            {chips.map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => setFilter(c.key)}
                className={`h-9 rounded-full px-4 text-[13px] font-semibold transition-colors ${
                  filter === c.key ? "bg-ink text-white" : "border border-line bg-white text-ink-soft hover:text-ink"
                }`}
              >
                {c.label} <span className="tabular-nums opacity-70">{c.count}</span>
              </button>
            ))}
          </div>
          <div className="overflow-hidden rounded-[20px] border border-line bg-white">
            <div className="hidden grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1.3fr)_minmax(0,0.9fr)_24px] gap-3 border-b border-line-soft bg-paper/60 px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-ink md:grid">
              <span>เว็บไซต์</span><span>WP / PHP</span><span>อัปเดต</span><span>Backup</span><span>ล่าสุด</span><span />
            </div>
            {shown.length === 0 && <p className="px-5 py-6 text-sm text-muted-ink">ไม่มีเว็บไซต์ในกลุ่มนี้</p>}
            <ul className="divide-y divide-line-soft">
              {shown.map((s) => (
                <SiteRow
                  key={s.id}
                  site={s}
                  now={now}
                  activity={activity.get(s.id) ?? null}
                  wake={wakes[s.id] ?? null}
                  oldestQueued={jobs.filter((j) => j.site_id === s.id && j.status === "queued").reduce((m, j) => Math.min(m, j.created_at), Infinity)}
                  open={openId === s.id}
                  onToggle={() => setOpenId(openId === s.id ? null : s.id)}
                >
                  <SiteCard
                    site={s} client={s.client} canManage={false}
                    canUpdate={canManage} paused={paused} jobs={jobs.filter((j) => j.site_id === s.id)} supportExpired={s.expired}
                  />
                </SiteRow>
              ))}
            </ul>
          </div>
          <p className="text-xs text-muted-ink">
            เชื่อมเว็บใหม่หรือตัดการเชื่อมต่อได้ที่หน้ารายละเอียดลูกค้า
          </p>
        </>
      )}

      {unconnected.length > 0 && (
        <section className="overflow-hidden rounded-[20px] border border-dashed border-line bg-white">
          <div className="border-b border-line-soft px-5 py-3.5">
            <p className="text-sm font-semibold text-ink">ยังไม่ได้เชื่อมปลั๊กอิน ({unconnected.length})</p>
            <p className="mt-0.5 text-xs text-muted-ink">ติดตั้ง Do Action: Care บนเว็บ แล้วจับคู่จากหน้าลูกค้า → แท็บเว็บไซต์ → “เชื่อมเว็บไซต์”</p>
          </div>
          <ul className="divide-y divide-line-soft">
            {unconnected.map((c) => (
              <li key={c.id}>
                <Link to={`/admin/clients/${c.id}?tab=sites`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-paper/60">
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 text-sm font-medium text-ink">
                      <span className="truncate">{c.company_name}</span>
                      {c.kind === "internal" && <span className="shrink-0 rounded-full bg-brand-yellow/40 px-1.5 text-[10px] font-semibold text-ink">ในเครือ</span>}
                      {c.expired && <span className="shrink-0 rounded-full bg-[#FDE7DA] px-1.5 text-[10px] font-semibold text-[#B4541A]">หมดสัญญา</span>}
                    </span>
                    <span className="block truncate text-xs text-muted-ink">{c.website_url?.replace(/^https?:\/\//, "").replace(/\/$/, "") || "ยังไม่ระบุเว็บไซต์"}</span>
                  </span>
                  <span className="shrink-0 text-xs font-semibold text-ink-soft">เชื่อมเว็บไซต์ ›</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
