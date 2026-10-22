import { useState } from "react";
import { Link, useLoaderData } from "react-router";
import type { Route } from "./+types/sites";
import { requireCoAdminOrAdmin } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";
import { ONLINE_WINDOW_S, SiteCard, type ConnectedSite } from "~/components/admin/connected-sites";

export function meta() {
  return [{ title: "เว็บไซต์ — Admin" }];
}

type SiteWithClient = ConnectedSite & { client: { id: string; name: string } };

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  await requireCoAdminOrAdmin(request, env.DB, env.SESSIONPORTAL);
  const rows = await createDB(env.DB).listAllSitesWithInventory();
  const sites: SiteWithClient[] = rows.map(
    ({ secret_enc: _s, inventory_json, client_id, client_company, ...row }) => {
      let inventory = null;
      try { inventory = inventory_json ? JSON.parse(inventory_json) : null; } catch { inventory = null; }
      return { ...row, inventory, client: { id: client_id, name: client_company } };
    },
  );
  return { sites, now: Math.floor(Date.now() / 1000) };
}

type Filter = "all" | "updates" | "silent";

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
  const { sites, now } = useLoaderData<typeof loader>();
  const [filter, setFilter] = useState<Filter>("all");

  const isSilent = (s: ConnectedSite) => !s.last_seen_at || now - s.last_seen_at >= ONLINE_WINDOW_S;
  const silent = sites.filter(isSilent);
  const needUpdates = sites.filter((s) => pendingUpdates(s) > 0);
  const totalUpdates = sites.reduce((n, s) => n + pendingUpdates(s), 0);
  const shown = filter === "updates" ? needUpdates : filter === "silent" ? silent : sites;

  const chips: { key: Filter; label: string; count: number }[] = [
    { key: "all", label: "ทั้งหมด", count: sites.length },
    { key: "updates", label: "รออัปเดต", count: needUpdates.length },
    { key: "silent", label: "ขาดการติดต่อ", count: silent.length },
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
          <p className="mt-1 text-sm text-[#B4541A]">{silent.length} เว็บไม่ได้ส่งข้อมูลเกิน 30 นาที</p>
        )}
      </div>

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
              <SiteCard key={s.id} site={s} client={s.client} canManage={false} />
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
