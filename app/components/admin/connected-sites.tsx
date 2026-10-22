import { Form, Link } from "react-router";
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

export function SiteCard({ site, canManage, client }: { site: ConnectedSite; canManage: boolean; client?: { id: string; name: string } }) {
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
  sites, canManage, pairCode, appUrl,
}: {
  sites: ConnectedSite[];
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
        {sites.map((s) => <SiteCard key={s.id} site={s} canManage={canManage} />)}
      </div>
    </div>
  );
}
