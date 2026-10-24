import { Form, Link, useFetcher, useRevalidator } from "react-router";
import { useEffect, useState } from "react";
import { ConfirmButton } from "~/components/ui/confirm-button";
import { NativeSelect } from "~/components/ui/native-select";
import { pendingUpdates, updateLevel, type UpdateLevel } from "~/lib/agent/update-level";
import { familyRoot } from "~/lib/agent/families";
import type { SiteInventory } from "~/lib/agent/inventory";

export type ConnectedSite = {
  id: string;
  site_url: string;
  paired_at: number;
  last_seen_at: number | null;
  revoked_at: number | null;
  plugin_version: string | null;
  wp_version: string | null;
  php_version: string | null;
  inventory: SiteInventory | null;
};

export type SiteJobView = {
  id: string; site_id: string; kind: "plugin" | "theme" | "core"; slug: string; name: string;
  from_version: string | null; to_version: string | null; result_version: string | null;
  status: "queued" | "running" | "succeeded" | "rolled_back" | "failed" | "cancelled";
  not_before: number; created_at: number; finished_at: number | null;
  has_log: number | boolean; created_by_name: string | null;
};

const JOB_STATUS: Record<SiteJobView["status"], { label: string; cls: string }> = {
  queued: { label: "รอคิว", cls: "bg-[#ECEAE3] text-ink-soft" },
  running: { label: "กำลังอัปเดต…", cls: "bg-brand-yellow text-ink" },
  succeeded: { label: "สำเร็จ", cls: "bg-emerald-50 text-emerald-700" },
  rolled_back: { label: "พัง — ย้อนกลับแล้ว", cls: "bg-[#FFF7EE] text-[#B4541A]" },
  failed: { label: "ไม่สำเร็จ", cls: "bg-red-50 text-destructive" },
  cancelled: { label: "ยกเลิก", cls: "bg-[#ECEAE3] text-muted-ink" },
};

function JobList({ jobs, siteId, canStop }: { jobs: SiteJobView[]; siteId: string; canStop: boolean }) {
  const fetcher = useFetcher();
  const stopper = useFetcher();
  const logFetcher = useFetcher<{ log: string }>();
  const [openLog, setOpenLog] = useState<string | null>(null);
  if (jobs.length === 0) return null;
  const queued = jobs.filter((j) => j.status === "queued").length;
  const running = jobs.some((j) => j.status === "running");
  return (
    <div className="mt-3 rounded-xl border border-line-soft bg-white">
      <div className="flex items-center justify-between gap-2 border-b border-line-soft px-3.5 py-2">
        <p className="text-xs font-semibold text-ink">ประวัติการอัปเดต (30 วัน)</p>
        {canStop && queued > 0 && (
          <button
            type="button"
            disabled={stopper.state !== "idle"}
            onClick={() => {
              if (confirm(`หยุดการอัปเดตของเว็บนี้ และยกเลิกงานที่รอคิว ${queued} รายการ?${running ? " (งานที่กำลังทำอยู่จะทำต่อจนจบ และย้อนกลับถ้าพัง)" : ""}`)) {
                stopper.submit({ intent: "site_stop", site_id: siteId }, { method: "post", action: "/admin/sites" });
              }
            }}
            className="inline-flex h-7 items-center rounded-full border border-line bg-white px-3 text-[11px] font-semibold text-destructive hover:bg-[#FFF7EE] disabled:opacity-60 transition-colors"
          >
            {stopper.state !== "idle" ? "กำลังหยุด…" : `หยุดเว็บนี้ (${queued})`}
          </button>
        )}
      </div>
      <ul className="max-h-72 divide-y divide-line-soft overflow-y-auto">
        {jobs.map((j) => (
          <li key={j.id} className="px-3.5 py-2 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0 truncate text-ink">
                {j.name} <span className="tabular-nums text-ink-soft">{j.from_version ?? ""} → {j.result_version ?? j.to_version ?? ""}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${JOB_STATUS[j.status].cls} ${j.status === "running" ? "animate-pulse" : ""}`}>
                  {j.status === "running" && <span className="inline-block h-2.5 w-2.5 animate-spin rounded-full border-2 border-ink/25 border-t-ink" aria-hidden="true" />}
                  {JOB_STATUS[j.status].label}
                </span>
                {j.status === "queued" && (
                  <button
                    type="button"
                    onClick={() => fetcher.submit({ intent: "job_cancel", job_id: j.id }, { method: "post", action: "/admin/sites" })}
                    className="text-[11px] font-semibold text-muted-ink hover:text-destructive"
                  >
                    ยกเลิก
                  </button>
                )}
                {Boolean(j.has_log) && (
                  <button type="button" onClick={() => { const next = openLog === j.id ? null : j.id; setOpenLog(next); if (next) logFetcher.load(`/api/site-job-log/${next}`); }} className="text-[11px] font-semibold text-muted-ink hover:text-ink">
                    log
                  </button>
                )}
              </span>
            </div>
            <p className="mt-0.5 text-[11px] text-muted-ink">
              {j.created_by_name ?? "อัตโนมัติ"} · {fmtDateTime(j.created_at)}
              {j.status === "queued" && j.not_before > j.created_at && ` · เริ่มได้ ${fmtDateTime(j.not_before)}`}
            </p>
            {openLog === j.id && (
              <pre className="mt-1.5 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-paper p-2 text-[11px] text-ink-soft">{logFetcher.state !== "idle" && !logFetcher.data ? "กำลังโหลด…" : logFetcher.data?.log}</pre>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

const BACKUP_TOOL: Record<string, string> = { updraftplus: "UpdraftPlus", ai1wm: "All-in-One WP Migration" };

function BackupLine({ inv }: { inv: NonNullable<ConnectedSite["inventory"]> }) {
  const b = inv.backup;
  const now = Math.floor(Date.now() / 1000);
  if (!b || b.sources.length === 0) {
    return <span className="rounded-full bg-[#FFF7EE] px-2.5 py-1 font-medium text-[#B4541A]">ไม่พบปลั๊กอิน backup</span>;
  }
  const age = b.last_at ? now - b.last_at : null;
  const stale = age == null || age > 36 * 3600;
  const src = b.sources.reduce((a, c) => (c.last_at > a.last_at ? c : a));
  const hours = age == null ? null : Math.floor(age / 3600);
  const failedEvent = b.sources.flatMap((x) => x.events).find((e) => e.enabled && e.last_status === "Failed");
  const onDrive = src.remote.includes("googledrive");
  return (
    <>
      <span className={`rounded-full px-2.5 py-1 font-medium ${stale || src.ok === false ? "bg-[#FFF7EE] text-[#B4541A]" : "bg-white text-ink-soft"}`}>
        Backup {hours == null ? "ยังไม่เคยมี" : `${hours < 1 ? "< 1 ชม." : hours >= 48 ? `${Math.floor(hours / 24)} วัน` : `${hours} ชม.`}ที่แล้ว`} · {BACKUP_TOOL[src.tool] ?? src.tool}
        {onDrive ? " · Google Drive" : " · ไม่พบการส่งขึ้น Drive"}
      </span>
      {failedEvent && (
        <span className="rounded-full bg-[#FFF7EE] px-2.5 py-1 font-medium text-[#B4541A]" title={failedEvent.last_error ?? ""}>
          ตั้งเวลา “{failedEvent.title}” ล้มล่าสุด{failedEvent.last_error ? `: ${failedEvent.last_error.slice(0, 60)}` : ""}
        </span>
      )}
    </>
  );
}

function RefreshButton({ siteId, lastSeen }: { siteId: string; lastSeen: number | null }) {
  const fetcher = useFetcher<{ ok?: string; error?: string }>();
  const revalidator = useRevalidator();
  const [waitingSince, setWaitingSince] = useState<number | null>(null);
  const msg = fetcher.data?.ok ?? fetcher.data?.error;

  // After a successful wake, reload the page data every 3 s until the site has
  // sent fresh data (last_seen_at moves past the click), for at most 90 s.
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok && waitingSince === null) setWaitingSince(Math.floor(Date.now() / 1000) - 2);
  }, [fetcher.state, fetcher.data, waitingSince]);
  const arrived = waitingSince !== null && lastSeen !== null && lastSeen >= waitingSince;
  useEffect(() => {
    if (waitingSince === null || arrived) return;
    const started = Date.now();
    const t = setInterval(() => {
      if (Date.now() - started > 90_000) { clearInterval(t); setWaitingSince(null); return; }
      if (revalidator.state === "idle") revalidator.revalidate();
    }, 3000);
    return () => clearInterval(t);
  }, [waitingSince, arrived, revalidator]);

  const label = fetcher.state !== "idle" ? "กำลังขอข้อมูล…"
    : fetcher.data?.error ? "ติดต่อไม่ได้"
    : arrived ? "อัปเดตแล้ว ✓"
    : waitingSince !== null ? "รอข้อมูลจากเว็บ…"
    : "รีเฟรชข้อมูล";
  return (
    <button
      type="button"
      disabled={fetcher.state !== "idle" || (waitingSince !== null && !arrived)}
      title={msg}
      onClick={() => { setWaitingSince(null); fetcher.submit({ intent: "site_refresh", site_id: siteId }, { method: "post", action: "/admin/sites" }); }}
      className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-muted-ink hover:text-ink disabled:opacity-60"
    >
      {(fetcher.state !== "idle" || (waitingSince !== null && !arrived)) && (
        <span className="inline-block h-2.5 w-2.5 animate-spin rounded-full border-2 border-ink/20 border-t-ink" aria-hidden="true" />
      )}
      {label}
    </button>
  );
}

function LevelBadge({ level }: { level: UpdateLevel }) {
  return level === "major" ? (
    <span className="shrink-0 rounded-full bg-[#FDE7DA] px-1.5 py-px text-[10px] font-bold uppercase tracking-wide text-[#B4541A]">Major</span>
  ) : (
    <span className="shrink-0 rounded-full bg-paper px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-muted-ink">{level === "minor" ? "Minor" : "Patch"}</span>
  );
}

function UpdateForm({ site, paused, jobs }: { site: ConnectedSite; paused: boolean; jobs: SiteJobView[] }) {
  const fetcher = useFetcher<{ ok?: string; error?: string }>();
  const inv = site.inventory!;
  const items = [
    ...(inv.core_update ? [{ key: "core:wordpress", name: "WordPress core", from: inv.wp_version, to: inv.core_update, active: true, blocked: inv.core_update_blocked, level: updateLevel("core", inv.wp_version, inv.core_update) }] : []),
    ...inv.plugins.filter((p) => p.update_version).map((p) => ({ key: `plugin:${p.slug}`, name: p.name, from: p.version, to: p.update_version!, active: p.active, blocked: p.update_blocked, level: updateLevel("plugin", p.version, p.update_version!) })),
    ...inv.themes.filter((t) => t.update_version).map((t) => ({ key: `theme:${t.slug}`, name: `${t.name} (ธีม)`, from: t.version, to: t.update_version!, active: t.active, blocked: t.update_blocked, level: updateLevel("theme", t.version, t.update_version!) })),
  ];
  // Items already queued or running are shown as such and cannot be picked again.
  const inFlight = new Map(
    jobs.filter((j) => j.status === "queued" || j.status === "running").map((j) => [`${j.kind}:${j.kind === "core" ? "wordpress" : j.slug}`, j.status])
  );
  // Nothing is picked until an admin picks it.
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  if (items.length === 0) return null;
  const busy = fetcher.state !== "idle";
  const pickable = [...selected].filter((k) => !inFlight.has(k));
  // A plugin and its add-ons are picked together (they're updated as one set).
  const slugs = inv.plugins.map((p) => p.slug);
  const familyOf = (k: string) => {
    if (!k.startsWith("plugin:")) return [k];
    const root = familyRoot(k.slice(7), slugs);
    return items.filter((i) => i.key.startsWith("plugin:") && !i.blocked && familyRoot(i.key.slice(7), slugs) === root).map((i) => i.key);
  };
  const toggle = (k: string) => setSelected((s) => {
    const n = new Set(s);
    const on = !n.has(k);
    for (const key of familyOf(k)) on ? n.add(key) : n.delete(key);
    return n;
  });
  const safe = items.filter((i) => i.level !== "major" && !i.blocked && !inFlight.has(i.key)).map((i) => i.key);

  return (
    <fetcher.Form method="post" action="/admin/sites" className="mt-3 rounded-xl border border-line-soft bg-white">
      <input type="hidden" name="intent" value="jobs_queue" />
      <input type="hidden" name="site_id" value={site.id} />
      <div className="flex items-center justify-between gap-2 border-b border-line-soft px-3.5 py-2">
        <p className="text-xs font-semibold text-ink">เลือกรายการที่จะอัปเดต</p>
        <span className="flex gap-3 text-[11px] font-semibold">
          {safe.length > 0 && <button type="button" onClick={() => setSelected(new Set(safe))} className="text-muted-ink hover:text-ink">เลือกที่ไม่ใช่ Major ({safe.length})</button>}
          {selected.size > 0 && <button type="button" onClick={() => setSelected(new Set())} className="text-muted-ink hover:text-ink">ล้าง</button>}
        </span>
      </div>
      <ul className="max-h-72 divide-y divide-line-soft overflow-y-auto">
        {items.map((it) => (
          <li key={it.key}>
            <label className="flex cursor-pointer items-center gap-2.5 px-3.5 py-2 text-xs">
              <input type="checkbox" name="item" value={it.key} disabled={Boolean(it.blocked) || inFlight.has(it.key)} checked={!it.blocked && !inFlight.has(it.key) && selected.has(it.key)} onChange={() => toggle(it.key)} className="h-4 w-4 accent-ink disabled:opacity-40" />
              <span className={`min-w-0 flex-1 ${it.active ? "text-ink" : "text-muted-ink"}`}>
                <span className="flex items-center gap-1.5">
                  <span className="truncate">{it.name}{!it.active && " (ปิดอยู่)"}</span>
                  <LevelBadge level={it.level} />
                  {inFlight.get(it.key) === "running" && (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-brand-yellow px-1.5 py-px text-[10px] font-bold text-ink">
                      <span className="inline-block h-2 w-2 animate-spin rounded-full border-2 border-ink/25 border-t-ink" aria-hidden="true" />
                      กำลังอัปเดต
                    </span>
                  )}
                  {inFlight.get(it.key) === "queued" && (
                    <span className="shrink-0 rounded-full bg-[#ECEAE3] px-1.5 py-px text-[10px] font-bold text-ink-soft">รอคิว</span>
                  )}
                </span>
                {it.level === "major" && !it.blocked && (
                  <span className="block text-[11px] text-[#B4541A]">เวอร์ชันใหญ่ อาจเปลี่ยนการทำงานหรือหน้าตา ควรเช็กหน้าเว็บหลังอัปเดต</span>
                )}
                {it.blocked && <span className="block text-[11px] text-[#B4541A]">ไม่รองรับ: {it.blocked}</span>}
              </span>
              <span className="shrink-0 tabular-nums text-ink-soft">{it.from} → <span className="font-semibold text-[#B4541A]">{it.to}</span></span>
            </label>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-3 border-t border-line-soft px-3.5 py-2.5">
        <NativeSelect name="window" defaultValue="now" size="sm" wrapperClassName="w-auto" className="rounded-full">
          <option value="now">เริ่มทันที</option>
          <option value="night">ตอนกลางคืน (01:00–05:00)</option>
        </NativeSelect>
        <ConfirmButton
          disabled={busy || paused || pickable.length === 0}
          message={
            <>
              อัปเดต {pickable.length} รายการบน {site.site_url}?<br />
              ระบบจะอัปเดตทีละรายการ (ปลั๊กอินหลักกับส่วนเสริมอัปเดตเป็นชุด) ตรวจหน้าเว็บหลังอัปเดต และย้อนกลับเวอร์ชันเดิมอัตโนมัติถ้าเว็บพัง
              {selected.has("core:wordpress") && " — WordPress core ย้อนกลับอัตโนมัติไม่ได้"}
            </>
          }
          confirmLabel="เริ่มอัปเดต"
          className="inline-flex h-8 items-center rounded-full bg-ink px-4 text-[12px] font-semibold text-white hover:bg-ink/90 disabled:opacity-40 transition-colors"
        >
          {busy ? "กำลังส่ง…" : `อัปเดต ${pickable.length} รายการ`}
        </ConfirmButton>
        {paused && <span className="text-[11px] text-[#B4541A]">ระบบหยุดอยู่</span>}
        {fetcher.data?.ok && <span className="text-[11px] text-emerald-700">{fetcher.data.ok}</span>}
        {fetcher.data?.error && <span className="text-[11px] text-destructive">{fetcher.data.error}</span>}
      </div>
    </fetcher.Form>
  );
}

/** Updates are offered only for sites that checked in recently. */
function isReachable(site: ConnectedSite) {
  return site.last_seen_at != null && Math.floor(Date.now() / 1000) - site.last_seen_at < SILENT_AFTER_S;
}

/** Sites send a heartbeat hourly (WP-cron, so later on quiet sites). */
export const ONLINE_WINDOW_S = 90 * 60;
export const SILENT_AFTER_S = 3 * 3600;

function fmtDateTime(unix: number | null) {
  if (!unix) return "—";
  return new Date(unix * 1000).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" });
}

function Countdown({ expiresAt }: { expiresAt: number }) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, expiresAt - now);
  if (left === 0) return <span className="text-destructive">หมดอายุแล้ว — สร้างรหัสใหม่</span>;
  return <span className="tabular-nums">หมดอายุใน {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}</span>;
}

function Status({ site }: { site: ConnectedSite }) {
  if (site.revoked_at) {
    return <span className="rounded-full bg-[#ECEAE3] px-2.5 py-0.5 text-[11px] font-semibold text-muted-ink">ตัดการเชื่อมต่อแล้ว</span>;
  }
  if (!site.last_seen_at) {
    return <span className="rounded-full bg-[#ECEAE3] px-2.5 py-0.5 text-[11px] font-semibold text-muted-ink">รอข้อมูลครั้งแรก</span>;
  }
  const age = Math.floor(Date.now() / 1000) - site.last_seen_at;
  if (age < ONLINE_WINDOW_S) {
    return <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700">● ออนไลน์</span>;
  }
  const hours = Math.max(1, Math.floor(age / 3600));
  return <span className="rounded-full bg-[#FFF7EE] px-2.5 py-0.5 text-[11px] font-semibold text-[#B4541A]">เงียบไป {hours} ชม.</span>;
}

export function SiteCard({
  site, canManage, client, jobs = [], canUpdate = false, paused = false, supportExpired = false,
}: {
  site: ConnectedSite; canManage: boolean; client?: { id: string; name: string };
  jobs?: SiteJobView[]; canUpdate?: boolean; paused?: boolean; supportExpired?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const inv = site.inventory;
  const pluginUpdates = inv?.plugins.filter((p) => p.update_version) ?? [];
  const themeUpdates = inv?.themes.filter((t) => t.update_version) ?? [];

  return (
    <div className={`rounded-[20px] border border-line bg-paper p-4 ${site.revoked_at ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-semibold text-ink">{site.site_url}</p>
            <Status site={site} />
            {canUpdate && !site.revoked_at && <RefreshButton siteId={site.id} lastSeen={site.last_seen_at} />}
          </div>
          {client && (
            <Link to={`/admin/clients/${client.id}`} className="mt-0.5 inline-block text-xs font-medium text-ink-soft hover:text-ink hover:underline underline-offset-2">
              {client.name}
            </Link>
          )}
          <p className="mt-1 text-xs text-muted-ink">
            WP {site.wp_version ?? "—"} · PHP {site.php_version ?? "—"} · ปลั๊กอิน {site.plugin_version ?? "—"} · ล่าสุด {fmtDateTime(site.last_seen_at)}
          </p>
        </div>
        {canManage && !site.revoked_at && (
          <Form method="post" className="shrink-0">
            <input type="hidden" name="intent" value="site_revoke" />
            <input type="hidden" name="site_id" value={site.id} />
            <ConfirmButton
              message={`ตัดการเชื่อมต่อ ${site.site_url}? ปลั๊กอินจะส่งข้อมูลไม่ได้จนกว่าจะจับคู่ใหม่`}
              confirmLabel="ตัดการเชื่อมต่อ"
              destructive
              className="inline-flex h-8 items-center rounded-full border border-line bg-white px-3.5 text-[12px] font-semibold text-destructive hover:bg-[#FFF7EE] transition-colors"
            >
              ตัดการเชื่อมต่อ
            </ConfirmButton>
          </Form>
        )}
      </div>

      {inv && (
        <>
          <div className="mt-3 flex flex-wrap gap-2 text-[12px]">
            {inv.core_update && (
              <span className="rounded-full bg-brand-yellow px-2.5 py-1 font-semibold text-ink">
                WordPress {inv.wp_version} → {inv.core_update}
              </span>
            )}
            {pendingUpdates(inv).some((u) => u.level === "major") && (
              <span className="rounded-full bg-[#FDE7DA] px-2.5 py-1 font-semibold text-[#B4541A]">
                Major {pendingUpdates(inv).filter((u) => u.level === "major").length} รายการ
              </span>
            )}
            <span className={`rounded-full px-2.5 py-1 font-medium ${pluginUpdates.length ? "bg-[#FFF7EE] text-[#B4541A]" : "bg-white text-ink-soft"}`}>
              ปลั๊กอินรออัปเดต {pluginUpdates.length}/{inv.plugins.length}
            </span>
            <span className={`rounded-full px-2.5 py-1 font-medium ${themeUpdates.length ? "bg-[#FFF7EE] text-[#B4541A]" : "bg-white text-ink-soft"}`}>
              ธีมรออัปเดต {themeUpdates.length}/{inv.themes.length}
            </span>
            <BackupLine inv={inv} />
            {inv.site_health && (
              <span className="rounded-full bg-white px-2.5 py-1 font-medium text-ink-soft">
                Site Health: วิกฤต {inv.site_health.critical} · แนะนำ {inv.site_health.recommended}
              </span>
            )}
          </div>

          {supportExpired && (
            <p className="mt-3 rounded-xl border border-[#F6D3B0] bg-[#FFF7EE] px-3.5 py-2.5 text-xs text-[#7A3410]">
              สัญญาดูแลหมดอายุ — ปิดการอัปเดตจากระยะไกล การแจ้งปัญหา และการเข้าระบบจาก wp-admin แล้ว (ยังเห็นสถานะเว็บได้ตามปกติ)
            </p>
          )}
          {canUpdate && !supportExpired && !site.revoked_at && inv.file_mods_allowed && isReachable(site) && <UpdateForm site={site} paused={paused} jobs={jobs} />}
          {canUpdate && !site.revoked_at && !isReachable(site) && (inv.core_update || pluginUpdates.length > 0 || themeUpdates.length > 0) && (
            <p className="mt-3 text-xs text-muted-ink">อัปเดตได้เมื่อเว็บกลับมาส่งข้อมูล (ขาดการติดต่อเกิน 3 ชม.)</p>
          )}
          <JobList jobs={jobs} siteId={site.id} canStop={canUpdate} />

          {!inv.file_mods_allowed && (
            <p className="mt-3 rounded-xl border border-[#F6D3B0] bg-[#FFF7EE] px-3.5 py-2.5 text-xs text-[#7A3410]">
              เว็บนี้ปิดการแก้ไขไฟล์ (DISALLOW_FILE_MODS หรือ FS_METHOD ไม่ใช่ direct) — อัปเดตจากระยะไกลในอนาคตจะทำไม่ได้
            </p>
          )}

          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="mt-3 text-xs font-semibold text-ink underline-offset-2 hover:underline"
          >
            {open ? "ซ่อนรายการ" : "ดูปลั๊กอินและธีมทั้งหมด"}
          </button>

          {open && (
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              {([["ปลั๊กอิน", inv.plugins], ["ธีม", inv.themes]] as const).map(([label, items]) => (
                <div key={label} className="rounded-xl border border-line-soft bg-white">
                  <p className="border-b border-line-soft px-3.5 py-2 text-xs font-semibold text-ink">{label} ({items.length})</p>
                  <ul className="max-h-72 divide-y divide-line-soft overflow-y-auto">
                    {items.map((it) => (
                      <li key={it.slug} className="flex items-center justify-between gap-3 px-3.5 py-2 text-xs">
                        <span className={`min-w-0 truncate ${it.active ? "text-ink" : "text-muted-ink"}`}>
                          {it.name}{!it.active && " (ปิดอยู่)"}
                        </span>
                        <span className="shrink-0 tabular-nums">
                          <span className="text-ink-soft">{it.version}</span>
                          {it.update_version && <span className="font-semibold text-[#B4541A]"> → {it.update_version}</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function ConnectedSitesSection({
  sites, canManage, pairCode, appUrl, jobs = [], paused = false, supportExpired = false,
}: {
  sites: ConnectedSite[];
  supportExpired?: boolean;
  jobs?: SiteJobView[];
  paused?: boolean;
  canManage: boolean;
  pairCode?: { code: string; expires_at: number };
  appUrl: string;
}) {
  return (
    <div className="rounded-[20px] border border-line bg-white overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-line-soft">
        <div className="min-w-0">
          <p className="text-[16px] font-semibold text-ink">เว็บไซต์ที่เชื่อมต่อ</p>
          <p className="text-xs text-muted-ink mt-0.5">ข้อมูลจากปลั๊กอิน Do Action: Care (อ่านอย่างเดียว)</p>
        </div>
        {canManage && (
          <Form method="post">
            <input type="hidden" name="intent" value="site_pair_create" />
            <button
              type="submit"
              className="inline-flex h-9 items-center rounded-full bg-ink px-4 text-[13px] font-semibold text-white hover:bg-ink/90 transition-colors"
            >
              เชื่อมเว็บไซต์
            </button>
          </Form>
        )}
      </div>
      <div className="p-5 space-y-3">
        {pairCode && (
          <div className="rounded-[20px] bg-brand-yellow/30 border border-line p-4 text-sm text-ink">
            <p className="text-xs text-ink-soft">รหัสจับคู่ (ใช้ได้ครั้งเดียว)</p>
            <p className="mt-1 font-display text-[28px] font-bold tracking-[0.15em] tabular-nums select-all">{pairCode.code}</p>
            <p className="text-xs text-ink-soft"><Countdown expiresAt={pairCode.expires_at} /></p>
            <ol className="mt-3 list-decimal space-y-1 pl-5 text-xs text-ink-soft">
              <li>ติดตั้งและเปิดใช้ปลั๊กอิน Do Action: Care บนเว็บไซต์ลูกค้า</li>
              <li>ไปที่ Settings → Do Action: Care</li>
              <li>ใส่ Portal URL <span className="font-mono text-ink select-all">{appUrl}</span> และรหัสด้านบน แล้วกด “เชื่อมต่อ”</li>
            </ol>
          </div>
        )}
        {sites.length === 0 && !pairCode && (
          <p className="text-sm text-muted-ink">ยังไม่มีเว็บไซต์ที่เชื่อมต่อ</p>
        )}
        {sites.map((s) => (
          <SiteCard key={s.id} site={s} canManage={canManage} canUpdate={canManage} paused={paused} supportExpired={supportExpired} jobs={jobs.filter((j) => j.site_id === s.id)} />
        ))}
      </div>
    </div>
  );
}
