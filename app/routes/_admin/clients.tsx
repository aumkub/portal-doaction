import { Form } from "react-router";
import { useState, useMemo, type FormEvent } from "react";
import type { Route } from "./+types/clients";
import { requireCoAdminOrAdmin } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";
import { formatRelativeTime } from "~/lib/utils";
import type { Client } from "~/types";
import { useT } from "~/lib/i18n";
import type { TranslationKey } from "~/lib/translations";
import { FaCirclePlus, FaEye, FaUserSecret, FaMagnifyingGlass, FaUsers, FaCircleCheck, FaClock } from "react-icons/fa6";

export function meta() {
  return [{ title: "จัดการลูกค้า — Admin" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const user = await requireCoAdminOrAdmin(request, context.cloudflare.env.DB, context.cloudflare.env.SESSIONPORTAL);
  const db = createDB(context.cloudflare.env.DB);

  let clients = await db.listClients();
  if (user.role === "co-admin") {
    const assignments = await db.listCoAdminClients(user.id);
    const assignedClientIds = assignments.map((a) => a.client_id);
    clients = clients.filter((c) => assignedClientIds.includes(c.id));
  }

  const clientsWithStatus = await Promise.all(
    clients.map(async (client) => {
      const u = await db.getUserById(client.user_id);
      return { ...client, first_login_at: u?.first_login_at ?? null };
    })
  );

  return { clients: clientsWithStatus, userRole: user.role };
}

const packageKeys: Record<Client["package"], TranslationKey> = {
  basic: "admin_pkg_basic",
  standard: "admin_pkg_standard",
  premium: "admin_pkg_premium",
};

const packageStyles = {
  basic:    { badge: "bg-slate-100 text-slate-600 ring-1 ring-slate-200",    dot: "bg-slate-400" },
  standard: { badge: "bg-blue-50 text-blue-600 ring-1 ring-blue-200",        dot: "bg-blue-500" },
  premium:  { badge: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",     dot: "bg-amber-500" },
};

function getInitials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

function avatarColor(name: string) {
  const colors = [
    "bg-violet-100 text-violet-700",
    "bg-blue-100 text-blue-700",
    "bg-emerald-100 text-emerald-700",
    "bg-orange-100 text-orange-700",
    "bg-rose-100 text-rose-700",
    "bg-indigo-100 text-indigo-700",
    "bg-teal-100 text-teal-700",
    "bg-pink-100 text-pink-700",
  ];
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) & 0xffff;
  return colors[hash % colors.length];
}

function ClientActions({
  client,
  isCoAdmin,
  t,
  confirmMsg,
}: {
  client: Client & { first_login_at: number | null };
  isCoAdmin: boolean;
  t: (key: TranslationKey) => string;
  confirmMsg: string;
}) {
  const btnCls = "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors";
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <a
        href={`/admin/clients/${client.id}`}
        className={`${btnCls} border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:border-slate-300`}
      >
        <FaEye className="text-[10px]" aria-hidden="true" />
        {t("admin_view_details")}
      </a>
      {!isCoAdmin && (
        <Form method="post" action="/api/impersonation/start" onSubmit={(e: FormEvent) => { if (!confirm(confirmMsg)) e.preventDefault(); }}>
          <input type="hidden" name="clientId" value={client.id} />
          <button type="submit" className={`${btnCls} border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100 hover:border-violet-300`}>
            <FaUserSecret className="text-[10px]" aria-hidden="true" />
            {t("admin_impersonate")}
          </button>
        </Form>
      )}
    </div>
  );
}

export default function AdminClientsPage({ loaderData }: Route.ComponentProps) {
  const { clients, userRole } = loaderData as {
    clients: Array<Client & { first_login_at: number | null }>;
    userRole: string;
  };
  const { t, lang } = useT();
  const [search, setSearch] = useState("");
  const [pkgFilter, setPkgFilter] = useState<"all" | Client["package"]>("all");

  const activated = clients.filter((c) => c.first_login_at).length;
  const pending    = clients.length - activated;

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return clients.filter((c) => {
      const matchesSearch =
        !q ||
        c.company_name.toLowerCase().includes(q) ||
        (c.website_url ?? "").toLowerCase().includes(q);
      const matchesPkg = pkgFilter === "all" || c.package === pkgFilter;
      return matchesSearch && matchesPkg;
    });
  }, [clients, search, pkgFilter]);

  const isCoAdmin = userRole === "co-admin";

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">
            {isCoAdmin ? "ลูกค้าที่ดูแล" : t("admin_clients_title")}
          </h1>
          <p className="text-slate-500 text-sm mt-0.5">
            {isCoAdmin
              ? `รายการลูกค้าที่คุณรับผิดชอบ`
              : t("admin_clients_subtitle").replace("{count}", String(clients.length))}
          </p>
        </div>
        {!isCoAdmin && (
          <a
            href="/admin/clients/new"
            className="inline-flex items-center gap-2 bg-[#F0D800] text-slate-900 rounded-lg px-4 py-2.5 text-sm font-semibold hover:bg-yellow-400 transition-colors shadow-sm self-start sm:self-auto"
          >
            <FaCirclePlus aria-hidden="true" />
            {t("admin_clients_add")}
          </a>
        )}
      </div>

      {/* ── Stats strip ── */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3.5 flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-600 shrink-0">
            <FaUsers className="text-sm" />
          </span>
          <div>
            <p className="text-xs text-slate-500">ทั้งหมด</p>
            <p className="text-xl font-semibold text-slate-900">{clients.length}</p>
          </div>
        </div>
        <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3.5 flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-100 text-emerald-600 shrink-0">
            <FaCircleCheck className="text-sm" />
          </span>
          <div>
            <p className="text-xs text-emerald-600">{t("admin_login_status_activated")}</p>
            <p className="text-xl font-semibold text-emerald-700">{activated}</p>
          </div>
        </div>
        <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3.5 flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-100 text-amber-600 shrink-0">
            <FaClock className="text-sm" />
          </span>
          <div>
            <p className="text-xs text-amber-600">{t("admin_login_status_pending")}</p>
            <p className="text-xl font-semibold text-amber-700">{pending}</p>
          </div>
        </div>
      </div>

      {/* ── Filters ── */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <FaMagnifyingGlass className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-xs" />
          <input
            type="search"
            placeholder="ค้นหาบริษัท หรือเว็บไซต์..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white pl-8 pr-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-400 transition"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          {(["all", "basic", "standard", "premium"] as const).map((pkg) => (
            <button
              key={pkg}
              onClick={() => setPkgFilter(pkg)}
              className={`px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${
                pkgFilter === pkg
                  ? "bg-slate-900 text-white border-slate-900"
                  : "bg-white text-slate-600 border-slate-200 hover:border-slate-300 hover:bg-slate-50"
              }`}
            >
              {pkg === "all" ? "ทั้งหมด" : t(packageKeys[pkg])}
            </button>
          ))}
        </div>
      </div>

      {/* ── List ── */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="px-5 py-16 text-center">
            <div className="flex flex-col items-center gap-2 text-slate-500">
              <FaUsers className="text-3xl opacity-30" />
              <p className="text-sm">{search || pkgFilter !== "all" ? "ไม่พบลูกค้าที่ค้นหา" : t("admin_clients_empty")}</p>
            </div>
          </div>
        ) : (
          <>
            {/* Desktop table — lg+ */}
            <div className="hidden lg:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/60">
                    <th className="text-left text-xs font-medium text-slate-500 px-5 py-3">{t("admin_col_client")}</th>
                    <th className="text-left text-xs font-medium text-slate-500 px-5 py-3">{t("admin_col_website")}</th>
                    <th className="text-left text-xs font-medium text-slate-500 px-5 py-3">{t("admin_col_package")}</th>
                    <th className="text-left text-xs font-medium text-slate-500 px-5 py-3">{t("admin_col_contract")}</th>
                    <th className="text-left text-xs font-medium text-slate-500 px-5 py-3">{t("admin_col_login_status")}</th>
                    <th className="px-5 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map((client) => {
                    const styles = packageStyles[client.package];
                    const initials = getInitials(client.company_name);
                    const avatarCls = avatarColor(client.company_name);
                    return (
                      <tr key={client.id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-3">
                            <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${avatarCls}`}>{initials}</span>
                            <span className="font-medium text-slate-900">{client.company_name}</span>
                          </div>
                        </td>
                        <td className="px-5 py-3.5 text-slate-500">
                          {client.website_url ? (
                            <a href={client.website_url} target="_blank" rel="noopener noreferrer"
                              className="hover:text-slate-900 hover:underline underline-offset-2 transition-colors max-w-[200px] truncate block">
                              {client.website_url.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                            </a>
                          ) : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-5 py-3.5">
                          <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${styles.badge}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${styles.dot}`} />
                            {t(packageKeys[client.package])}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-slate-500 text-sm">
                          {client.contract_end ?? <span className="text-slate-500 text-xs">{t("settings_contract_no_expiry")}</span>}
                        </td>
                        <td className="px-5 py-3.5">
                          {client.first_login_at ? (
                            <div>
                              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">
                                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />{t("admin_login_status_activated")}
                              </span>
                              <p className="text-[11px] text-slate-500 mt-1">{formatRelativeTime(client.first_login_at, lang)}</p>
                            </div>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 ring-1 ring-amber-200">
                              <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />{t("admin_login_status_pending")}
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3.5">
                          <ClientActions client={client} isCoAdmin={isCoAdmin} t={t} confirmMsg={`${t("admin_impersonate_confirm")} ${client.company_name}?`} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Cards — below lg */}
            <div className="lg:hidden divide-y divide-slate-100">
              {filtered.map((client) => {
                const styles = packageStyles[client.package];
                const initials = getInitials(client.company_name);
                const avatarCls = avatarColor(client.company_name);
                return (
                  <div key={client.id} className="p-4 space-y-3">
                    {/* Top: avatar + name + package */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${avatarCls}`}>{initials}</span>
                        <div className="min-w-0">
                          <p className="font-medium text-slate-900 text-sm truncate">{client.company_name}</p>
                          {client.website_url && (
                            <a href={client.website_url} target="_blank" rel="noopener noreferrer"
                              className="text-xs text-slate-500 hover:text-slate-700 hover:underline underline-offset-2 truncate block max-w-[200px]">
                              {client.website_url.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                            </a>
                          )}
                        </div>
                      </div>
                      <span className={`inline-flex shrink-0 items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${styles.badge}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${styles.dot}`} />
                        {t(packageKeys[client.package])}
                      </span>
                    </div>

                    {/* Meta row */}
                    <div className="flex items-center gap-3 flex-wrap">
                      {client.first_login_at ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />{t("admin_login_status_activated")}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 ring-1 ring-amber-200">
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />{t("admin_login_status_pending")}
                        </span>
                      )}
                      {client.contract_end && (
                        <span className="text-xs text-slate-500">{t("admin_col_contract")}: {client.contract_end}</span>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2 flex-wrap">
                      <ClientActions client={client} isCoAdmin={isCoAdmin} t={t} confirmMsg={`${t("admin_impersonate_confirm")} ${client.company_name}?`} />
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {filtered.length > 0 && (
          <div className="border-t border-slate-100 px-5 py-2.5 bg-slate-50/40">
            <p className="text-xs text-slate-500">แสดง {filtered.length} จาก {clients.length} รายการ</p>
          </div>
        )}
      </div>
    </div>
  );
}
