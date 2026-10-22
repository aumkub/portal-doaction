import { Form, Link, useFetcher } from "react-router";
import { useEffect, useState } from "react";
import { ConfirmButton } from "~/components/ui/confirm-button";
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
  id: string; site_id: string; kind: "plugin" | "theme" | "core"; name: string;
  from_version: string | null; to_version: string | null; result_version: string | null;
  status: "queued" | "running" | "succeeded" | "rolled_back" | "failed" | "cancelled";
  not_before: number; created_at: number; finished_at: number | null;
  log: string | null; created_by_name: string | null;
};

const JOB_STATUS: Record<SiteJobView["status"], { label: string; cls: string }> = {
  queued: { label: "รอคิว", cls: "bg-[#ECEAE3] text-ink-soft" },
  running: { label: "กำลังอัปเดต…", cls: "bg-brand-yellow text-ink" },
  succeeded: { label: "สำเร็จ", cls: "bg-emerald-50 text-emerald-700" },
  rolled_back: { label: "พัง — ย้อนกลับแล้ว", cls: "bg-[#FFF7EE] text-[#B4541A]" },
  failed: { label: "ไม่สำเร็จ", cls: "bg-red-50 text-destructive" },
  cancelled: { label: "ยกเลิก", cls: "bg-[#ECEAE3] text-muted-ink" },
};

function JobList({ jobs }: { jobs: SiteJobView[] }) {
  const fetcher = useFetcher();
  const [openLog, setOpenLog] = useState<string | null>(null);
  if (jobs.length === 0) return null;
  return (
    <div className="mt-3 rounded-xl border border-line-soft bg-white">
      <p className="border-b border-line-soft px-3.5 py-2 text-xs font-semibold text-ink">ประวัติการอัปเดต (30 วัน)</p>
      <ul className="max-h-72 divide-y divide-line-soft overflow-y-auto">
        {jobs.map((j) => (
          <li key={j.id} className="px-3.5 py-2 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0 truncate text-ink">
                {j.name} <span className="tabular-nums text-ink-soft">{j.from_version ?? ""} → {j.result_version ?? j.to_version ?? ""}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${JOB_STATUS[j.status].cls}`}>{JOB_STATUS[j.status].label}</span>
                {j.status === "queued" && (
                  <button
                    type="button"
                    onClick={() => fetcher.submit({ intent: "job_cancel", job_id: j.id }, { method: "post", action: "/admin/sites" })}
                    className="text-[11px] font-semibold text-muted-ink hover:text-destructive"
                  >
                    ยกเลิก
                  </button>
                )}
                {j.log && (
                  <button type="button" onClick={() => setOpenLog(openLog === j.id ? null : j.id)} className="text-[11px] font-semibold text-muted-ink hover:text-ink">
                    log
                  </button>
                )}
              </span>
            </div>
            <p className="mt-0.5 text-[11px] text-muted-ink">
              {j.created_by_name ?? "อัตโนมัติ"} · {fmtDateTime(j.created_at)}
              {j.status === "queued" && j.not_before > j.created_at && ` · เริ่มได้ ${fmtDateTime(j.not_before)}`}
            </p>
            {openLog === j.id && j.log && (
              <pre className="mt-1.5 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-paper p-2 text-[11px] text-ink-soft">{j.log}</pre>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function UpdateForm({ site, paused }: { site: ConnectedSite; paused: boolean }) {
  const fetcher = useFetcher<{ ok?: string; error?: string }>();
  const inv = site.inventory!;
  const items = [
    ...(inv.core_update ? [{ key: "core:wordpress", name: "WordPress core", from: inv.wp_version, to: inv.core_update, active: true }] : []),
    ...inv.plugins.filter((p) => p.update_version).map((p) => ({ key: `plugin:${p.slug}`, name: p.name, from: p.version, to: p.update_version!, active: p.active })),
    ...inv.themes.filter((t) => t.update_version).map((t) => ({ key: `theme:${t.slug}`, name: `${t.name} (ธีม)`, from: t.version, to: t.update_version!, active: t.active })),
  ];
  const [selected, setSelected] = useState<Set<string>>(() => new Set(items.filter((i) => i.key !== "core:wordpress").map((i) => i.key)));
  if (items.length === 0) return null;
  const busy = fetcher.state !== "idle";
  const toggle = (k: string) => setSelected((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });

  return (
    <fetcher.Form method="post" action="/admin/sites" className="mt-3 rounded-xl border border-line-soft bg-white">
      <input type="hidden" name="intent" value="jobs_queue" />
      <input type="hidden" name="site_id" value={site.id} />
      <p className="border-b border-line-soft px-3.5 py-2 text-xs font-semibold text-ink">เลือกรายการที่จะอัปเดต</p>
      <ul className="max-h-72 divide-y divide-line-soft overflow-y-auto">
        {items.map((it) => (
          <li key={it.key}>
            <label className="flex cursor-pointer items-center gap-2.5 px-3.5 py-2 text-xs">
              <input type="checkbox" name="item" value={it.key} checked={selected.has(it.key)} onChange={() => toggle(it.key)} className="h-4 w-4 accent-ink" />
              <span className={`min-w-0 flex-1 truncate ${it.active ? "text-ink" : "text-muted-ink"}`}>{it.name}{!it.active && " (ปิดอยู่)"}</span>
              <span className="shrink-0 tabular-nums text-ink-soft">{it.from} → <span className="font-semibold text-[#B4541A]">{it.to}</span></span>
            </label>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-3 border-t border-line-soft px-3.5 py-2.5">
        <select name="window" defaultValue="now" className="h-8 rounded-full border border-line bg-white px-3 text-[12px] text-ink">
          <option value="now">เริ่มทันที</option>
          <option value="night">ตอนกลางคืน (01:00–05:00)</option>
        </select>
        <ConfirmButton
          disabled={busy || paused || selected.size === 0}
          message={
            <>
              อัปเดต {selected.size} รายการบน {site.site_url}?<br />
              ระบบจะอัปเดตทีละรายการ ตรวจหน้าเว็บหลังแต่ละรายการ และย้อนกลับเวอร์ชันเดิมอัตโนมัติถ้าเว็บพัง
              {selected.has("core:wordpress") && " — WordPress core ย้อนกลับอัตโนมัติไม่ได้ ระบบจะเช็กว่ามี backup ภายใน 24 ชม. ก่อน"}
            </>
          }
          confirmLabel="เริ่มอัปเดต"
          className="inline-flex h-8 items-center rounded-full bg-ink px-4 text-[12px] font-semibold text-white hover:bg-ink/90 disabled:opacity-40 transition-colors"
        >
          {busy ? "กำลังส่ง…" : `อัปเดต ${selected.size} รายการ`}
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
  return site.last_seen_at != null && Math.floor(Date.now() / 1000) - site.last_seen_at < 2 * 3600;
}

export const ONLINE_WINDOW_S = 30 * 60;

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
  site, canManage, client, jobs = [], canUpdate = false, paused = false,
}: {
  site: ConnectedSite; canManage: boolean; client?: { id: string; name: string };
  jobs?: SiteJobView[]; canUpdate?: boolean; paused?: boolean;
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
            <span className={`rounded-full px-2.5 py-1 font-medium ${pluginUpdates.length ? "bg-[#FFF7EE] text-[#B4541A]" : "bg-white text-ink-soft"}`}>
              ปลั๊กอินรออัปเดต {pluginUpdates.length}/{inv.plugins.length}
            </span>
            <span className={`rounded-full px-2.5 py-1 font-medium ${themeUpdates.length ? "bg-[#FFF7EE] text-[#B4541A]" : "bg-white text-ink-soft"}`}>
              ธีมรออัปเดต {themeUpdates.length}/{inv.themes.length}
            </span>
            {inv.site_health && (
              <span className="rounded-full bg-white px-2.5 py-1 font-medium text-ink-soft">
                Site Health: วิกฤต {inv.site_health.critical} · แนะนำ {inv.site_health.recommended}
              </span>
            )}
          </div>

          {canUpdate && !site.revoked_at && inv.file_mods_allowed && isReachable(site) && <UpdateForm site={site} paused={paused} />}
          {canUpdate && !site.revoked_at && !isReachable(site) && (inv.core_update || pluginUpdates.length > 0 || themeUpdates.length > 0) && (
            <p className="mt-3 text-xs text-muted-ink">อัปเดตได้เมื่อเว็บกลับมาส่งข้อมูล (ขาดการติดต่อเกิน 2 ชม.)</p>
          )}
          <JobList jobs={jobs} />

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
  sites, canManage, pairCode, appUrl, jobs = [], paused = false,
}: {
  sites: ConnectedSite[];
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
          <p className="text-xs text-muted-ink mt-0.5">ข้อมูลจากปลั๊กอิน do action Care (อ่านอย่างเดียว)</p>
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
              <li>ติดตั้งและเปิดใช้ปลั๊กอิน do action Care บนเว็บไซต์ลูกค้า</li>
              <li>ไปที่ Settings → do action Care</li>
              <li>ใส่ Portal URL <span className="font-mono text-ink select-all">{appUrl}</span> และรหัสด้านบน แล้วกด “เชื่อมต่อ”</li>
            </ol>
          </div>
        )}
        {sites.length === 0 && !pairCode && (
          <p className="text-sm text-muted-ink">ยังไม่มีเว็บไซต์ที่เชื่อมต่อ</p>
        )}
        {sites.map((s) => (
          <SiteCard key={s.id} site={s} canManage={canManage} canUpdate paused={paused} jobs={jobs.filter((j) => j.site_id === s.id)} />
        ))}
      </div>
    </div>
  );
}
