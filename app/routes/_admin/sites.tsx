import { useState } from "react";
import { Form, Link, useLoaderData, useSearchParams } from "react-router";
import { backupIssues } from "~/lib/agent/backup-health";
import type { Route } from "./+types/sites";
import { requireCoAdminOrAdmin } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";
import { ONLINE_WINDOW_S, SILENT_AFTER_S, SiteCard, type ConnectedSite } from "~/components/admin/connected-sites";
import { CARE_PAUSED_KEY, nextNightWindow, queueJobs, wakeSite, type JobRequest } from "~/lib/agent/jobs.server";
import { InventorySchema } from "~/lib/agent/inventory";
import { ConfirmButton } from "~/components/ui/confirm-button";

export function meta() {
  return [{ title: "เว็บไซต์ — Admin" }];
}

type SiteWithClient = ConnectedSite & { client: { id: string; name: string }; internal: boolean };

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  await requireCoAdminOrAdmin(request, env.DB, env.SESSIONPORTAL);
  const db = createDB(env.DB);
  const rows = await db.listAllSitesWithInventory();
  const sites: SiteWithClient[] = rows.map(
    ({ secret_enc: _s, inventory_json, client_id, client_company, client_kind, ...row }) => {
      let inventory = null;
      try { inventory = inventory_json ? JSON.parse(inventory_json) : null; } catch { inventory = null; }
      return { ...row, inventory, client: { id: client_id, name: client_company }, internal: client_kind === "internal" };
    },
  );
  const now = Math.floor(Date.now() / 1000);
  const jobs = await db.listSiteJobs({ site_ids: sites.map((x) => x.id), since: now - 30 * 86400, limit: 300 });
  const paused = Boolean(await env.SESSIONPORTAL.get(CARE_PAUSED_KEY));
  return { sites, jobs, paused, now };
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const user = await requireCoAdminOrAdmin(request, env.DB, env.SESSIONPORTAL);
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

type Filter = "all" | "updates" | "silent" | "backup" | "internal";
const FILTERS: Filter[] = ["all", "updates", "silent", "backup", "internal"];

function pendingUpdates(site: ConnectedSite) {
  const inv = site.inventory;
  if (!inv) return 0;
  return (
    (inv.core_update ? 1 : 0) +
    inv.plugins.filter((p) => p.update_version).length +
    inv.themes.filter((t) => t.update_version).length
  );
}

export default function AdminSitesPage() {
  const { sites, jobs, paused, now } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const initial = searchParams.get("filter") as Filter | null;
  const [filter, setFilter] = useState<Filter>(initial && FILTERS.includes(initial) ? initial : "all");

  const isSilent = (s: ConnectedSite) => !s.last_seen_at || now - s.last_seen_at >= SILENT_AFTER_S;
  const silent = sites.filter(isSilent);
  const needUpdates = sites.filter((s) => pendingUpdates(s) > 0);
  const totalUpdates = sites.reduce((n, s) => n + pendingUpdates(s), 0);
  const backupBad = sites.filter((x) => backupIssues(x.inventory, now).length > 0);
  const shown = filter === "backup" ? backupBad : filter === "updates" ? needUpdates : filter === "silent" ? silent : filter === "internal" ? sites.filter((x) => x.internal) : sites;

  const chips: { key: Filter; label: string; count: number }[] = [
    { key: "all", label: "ทั้งหมด", count: sites.length },
    { key: "updates", label: "รออัปเดต", count: needUpdates.length },
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

      {sites.length === 0 ? (
        <div className="rounded-[20px] border border-line bg-white p-6 text-sm text-ink-soft">
          เชื่อมเว็บไซต์ได้จากหน้ารายละเอียดลูกค้า → การ์ด “เว็บไซต์ที่เชื่อมต่อ” → ปุ่ม “เชื่อมเว็บไซต์”{" "}
          <Link to="/admin/clients" className="font-semibold text-ink underline underline-offset-2">ไปที่รายชื่อลูกค้า</Link>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
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
          <div className="space-y-3">
            {shown.length === 0 && <p className="text-sm text-muted-ink">ไม่มีเว็บไซต์ในกลุ่มนี้</p>}
            {shown.map((s) => (
              <SiteCard
                key={s.id} site={s} client={s.client} canManage={false}
                canUpdate paused={paused} jobs={jobs.filter((j) => j.site_id === s.id)}
              />
            ))}
          </div>
          <p className="text-xs text-muted-ink">
            เชื่อมเว็บใหม่หรือตัดการเชื่อมต่อได้ที่หน้ารายละเอียดลูกค้า
          </p>
        </>
      )}
    </div>
  );
}
