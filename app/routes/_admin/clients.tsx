import { Form } from "react-router";
import { ConfirmButton } from "~/components/ui/confirm-button";
import { isContractExpired, OWN_COMPANY_NAME } from "~/lib/contract";
import { useState, useMemo, type FormEvent } from "react";
import type { Route } from "./+types/clients";
import Pagination from "~/components/ui/Pagination";
import { requireCoAdminOrAdmin } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";
import { formatRelativeTime } from "~/lib/utils";
import type { Client } from "~/types";
import { useT } from "~/lib/i18n";
import type { TranslationKey } from "~/lib/translations";
import { FaCirclePlus, FaEye, FaUserSecret, FaMagnifyingGlass, FaUsers, FaClock, FaCloud, FaFileCircleXmark, FaCircleCheck } from "react-icons/fa6";

export function meta() {
  return [{ title: "จัดการลูกค้า — Admin" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const user = await requireCoAdminOrAdmin(request, context.cloudflare.env.DB, context.cloudflare.env.SESSIONPORTAL);
  const db = createDB(context.cloudflare.env.DB);

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1; // 1-12

  let clients = await db.listClients();
  if (user.role === "co-admin") {
    const assignments = await db.listCoAdminClients(user.id);
    const assignedClientIds = assignments.map((a) => a.client_id);
    clients = clients.filter((c) => assignedClientIds.includes(c.id));
  }

  const allClientsWithStatus = await Promise.all(
    clients.map(async (client) => {
      const u = await db.getUserById(client.user_id);
      // Hardcode: บริษัท ดู แอคชั่น จำกัด doesn't need monthly reports (testing account)
      const skipReportCheck = client.company_name === OWN_COMPANY_NAME;
      // Expired contracts get no monthly report, so there is nothing to check.
      const contractExpired = isContractExpired(client.contract_end);
      let has_monthly_report = false;
      if (!skipReportCheck && !contractExpired) {
        const report = await db.getReportByMonth(client.id, currentYear, currentMonth);
        has_monthly_report = report !== null;
      }
      return { 
        ...client, 
        first_login_at: u?.first_login_at ?? null,
        has_monthly_report: skipReportCheck ? true : has_monthly_report,
        skip_report_check: skipReportCheck,
        contract_expired: contractExpired,
      };
    })
  );

  const PAGE_SIZE = 20;
  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1"));

  // Expired contracts are hidden unless asked for. Dates are YYYY-MM-DD, so a
  // string compare against today's Bangkok date is enough.
  const contractParam = url.searchParams.get("contract");
  const contractFilter: ContractFilter =
    contractParam === "expired" || contractParam === "all" ? contractParam : "active";
  const isExpired = (c: { contract_end: string | null }) => isContractExpired(c.contract_end);
  const expiredCount = allClientsWithStatus.filter(isExpired).length;
  const contractScoped = allClientsWithStatus.filter((c) =>
    contractFilter === "all" ? true : contractFilter === "expired" ? isExpired(c) : !isExpired(c)
  );
  const total = contractScoped.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const clientsWithStatus = contractScoped.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return {
    clients: clientsWithStatus,
    userRole: user.role,
    page: safePage,
    totalPages,
    total,
    currentMonth,
    currentYear,
    contractFilter,
    expiredCount,
    activeCount: allClientsWithStatus.length - expiredCount,
  };
}

type ContractFilter = "active" | "expired" | "all";

const packageKeys: Record<Client["package"], TranslationKey> = {
  basic: "admin_pkg_basic",
  standard: "admin_pkg_standard",
  premium: "admin_pkg_premium",
};

const packageStyles = {
  basic:    { badge: "bg-paper text-muted-ink",        dot: "bg-faint-ink" },
  standard: { badge: "bg-sky-50 text-sky-700",         dot: "bg-sky-500" },
  premium:  { badge: "bg-brand-yellow text-ink",       dot: "bg-ink" },
};

function getInitials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

function BackupConnectedIcon({
  path,
  t,
}: {
  path: string | null | undefined;
  t: (key: TranslationKey) => string;
}) {
  if (!path?.trim()) {
    return <span className="text-faint-ink text-xs" aria-hidden="true">—</span>;
  }
  return (
    <span
      className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700"
      title={t("admin_col_backup_linked").replace("{path}", path)}
    >
      <FaCloud className="text-xs" aria-label={t("admin_col_backup_linked").replace("{path}", path)} />
    </span>
  );
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
  const btnCls = "inline-flex items-center gap-1.5 h-9 rounded-full border px-3.5 text-xs font-semibold transition-colors";
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <a
        href={`/admin/clients/${client.id}`}
        className={`${btnCls} border-line bg-white text-ink hover:bg-paper`}
      >
        <FaEye className="text-[10px]" aria-hidden="true" />
        {t("admin_view_details")}
      </a>
      {!isCoAdmin && (
        <Form method="post" action="/api/impersonation/start">
          <input type="hidden" name="clientId" value={client.id} />
          <ConfirmButton message={confirmMsg} confirmLabel={t("admin_impersonate")} className={`${btnCls} border-ink bg-ink text-white hover:bg-black`}>
            <FaUserSecret className="text-[10px]" aria-hidden="true" />
            {t("admin_impersonate")}
          </ConfirmButton>
        </Form>
      )}
    </div>
  );
}

export default function AdminClientsPage({ loaderData }: Route.ComponentProps) {
  const { clients, userRole, page, totalPages, total, currentMonth, currentYear, contractFilter, expiredCount, activeCount } = loaderData as {
    clients: Array<Client & { first_login_at: number | null; has_monthly_report: boolean; skip_report_check?: boolean; contract_expired: boolean }>;
    userRole: string;
    page: number;
    totalPages: number;
    total: number;
    currentMonth: number;
    currentYear: number;
    contractFilter: ContractFilter;
    expiredCount: number;
    activeCount: number;
  };
  const { t, lang } = useT();
  const [search, setSearch] = useState("");
  const [reportFilter, setReportFilter] = useState<"all" | "missing" | "has">("all");

  const activated = clients.filter((c) => c.first_login_at).length;
  const pending    = clients.length - activated;

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return clients.filter((c) => {
      const matchesSearch =
        !q ||
        c.company_name.toLowerCase().includes(q) ||
        (c.website_url ?? "").toLowerCase().includes(q);
      const matchesReport =
        reportFilter === "all" ||
        (reportFilter === "missing" && !c.contract_expired && !c.has_monthly_report) ||
        (reportFilter === "has" && !c.contract_expired && c.has_monthly_report);
      return matchesSearch && matchesReport;
    });
  }, [clients, search, reportFilter]);

  const isCoAdmin = userRole === "co-admin";

  return (
    <div className="space-y-5">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm text-muted-ink">
            {isCoAdmin ? "ลูกค้าที่ดูแล" : t("admin_clients_title")}
          </p>
          <h1 className="mt-1.5 text-[28px] md:text-[32px] font-bold tracking-[-0.02em] text-ink">
            {t("rd_admin_clients_headline").replace("{n}", String(total))}
          </h1>
        </div>
        {!isCoAdmin && (
          <a
            href="/admin/clients/new"
            className="inline-flex h-10 items-center gap-2 rounded-full bg-ink px-5 text-[13px] font-semibold text-white hover:bg-black"
          >
            <FaCirclePlus aria-hidden="true" />
            {t("admin_clients_add")}
          </a>
        )}
      </div>

      {/* ── Stats strip ── */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "ทั้งหมด", value: clients.length },
          { label: t("admin_login_status_activated"), value: activated },
          { label: t("admin_login_status_pending"), value: pending },
        ].map((s) => (
          <div key={s.label} className="rounded-[18px] border border-line bg-white p-4 sm:p-[18px]">
            <p className="text-[13px] text-muted-ink truncate">{s.label}</p>
            <p className="mt-2 font-display text-[28px] sm:text-[34px] font-bold leading-none tracking-[-0.03em] tabular-nums text-ink">{s.value}</p>
          </div>
        ))}
      </div>

      {/* ── Filters ── */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="relative flex-1">
          <FaMagnifyingGlass className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-faint-ink text-xs" />
          <input
            type="search"
            placeholder="ค้นหาบริษัท หรือเว็บไซต์..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-10 rounded-xl border border-line bg-white pl-9 pr-3.5 text-sm text-ink placeholder:text-faint-ink focus:outline-none focus:ring-2 focus:ring-ink/10 focus:border-ink/40 transition"
          />
        </div>
        <div className="inline-flex self-start rounded-full bg-paper p-[3px] max-w-full overflow-x-auto">
          {([
            { value: "active" as const, label: lang === "en" ? "Active" : "ใช้งานอยู่", count: activeCount },
            { value: "expired" as const, label: lang === "en" ? "Expired" : "หมดอายุ", count: expiredCount },
            { value: "all" as const, label: lang === "en" ? "All" : "ทั้งหมด", count: activeCount + expiredCount },
          ]).map((opt) => (
            <a
              key={opt.value}
              href={opt.value === "active" ? "/admin/clients" : `/admin/clients?contract=${opt.value}`}
              aria-current={contractFilter === opt.value ? "page" : undefined}
              className={`flex h-9 items-center gap-1.5 px-3.5 rounded-full text-[13px] font-medium whitespace-nowrap transition-colors ${
                contractFilter === opt.value
                  ? "bg-white text-ink shadow-[0_1px_2px_rgba(0,0,0,0.08)]"
                  : "text-muted-ink hover:text-ink"
              }`}
            >
              {opt.label}
              <span className="text-xs text-faint-ink tabular-nums">{opt.count}</span>
            </a>
          ))}
        </div>
        <div className="inline-flex self-start rounded-full bg-paper p-[3px] max-w-full overflow-x-auto">
          {([
            { value: "all" as const, label: "ทั้งหมด" },
            { value: "missing" as const, label: "ยังไม่มี Report" },
            { value: "has" as const, label: "มี Report แล้ว" },
          ] as const).map((opt) => (
            <button
              key={opt.value}
              onClick={() => setReportFilter(opt.value)}
              className={`h-9 px-3.5 rounded-full text-[13px] font-medium whitespace-nowrap transition-colors ${
                reportFilter === opt.value
                  ? "bg-white text-ink shadow-[0_1px_2px_rgba(0,0,0,0.08)]"
                  : "text-muted-ink hover:text-ink"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── List ── */}
      <div className="rounded-[20px] border border-line bg-white overflow-hidden">
        {filtered.length === 0 ? (
          <div className="px-5 py-16 text-center">
            <div className="flex flex-col items-center gap-2 text-muted-ink">
              <FaUsers className="text-base text-faint-ink" />
              <p className="text-sm">{search || reportFilter !== "all" ? "ไม่พบลูกค้าที่ค้นหา" : t("admin_clients_empty")}</p>
            </div>
          </div>
        ) : (
          <>
            {/* Desktop table — lg+ */}
            <div className="hidden lg:block overflow-x-auto">
              <table className="w-full text-sm md:min-w-[1024px]">
                <thead>
                  <tr className="border-b border-line-soft">
                    <th className="text-left text-xs font-medium text-muted-ink px-5 py-3">{t("admin_col_client")}</th>
                    <th className="text-center text-xs font-medium text-muted-ink px-5 py-3 w-14" title="Report ประจำเดือน">
                      <FaFileCircleXmark className="inline text-faint-ink text-[10px]" aria-hidden="true" />
                      <span className="sr-only">Report ประจำเดือน</span>
                    </th>
                    <th className="text-left text-xs font-medium text-muted-ink px-5 py-3">{t("admin_col_website")}</th>
                    <th className="text-left text-xs font-medium text-muted-ink px-5 py-3">{t("admin_col_package")}</th>
                    <th className="text-left text-xs font-medium text-muted-ink px-5 py-3">{t("admin_col_contract")}</th>
                    <th className="text-left text-xs font-medium text-muted-ink px-5 py-3">{t("admin_col_login_status")}</th>
                    {!isCoAdmin && (
                      <th className="text-center text-xs font-medium text-muted-ink px-5 py-3 w-14" title={t("admin_col_backup")}>
                        <FaCloud className="inline text-faint-ink text-[10px]" aria-hidden="true" />
                        <span className="sr-only">{t("admin_col_backup")}</span>
                      </th>
                    )}
                    <th className="px-5 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F4F2EC]">
                  {filtered.map((client) => {
                    const styles = packageStyles[client.package];
                    const initials = getInitials(client.company_name);
                    const missingReport = !client.has_monthly_report;
                    const hideReport = client.contract_expired;
                    return (
                      <tr key={client.id} className="hover:bg-paper/60 transition-colors">
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-3">
                            <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-paper text-ink text-xs font-semibold`}>{initials}</span>
                            <span className="font-medium text-ink min-w-[180px]">{client.company_name}</span>
                          </div>
                        </td>
                        <td className="px-5 py-3.5">
                          {hideReport ? (
                            <span className="rounded-full bg-paper px-2.5 py-0.5 text-xs font-semibold text-muted-ink whitespace-nowrap">
                              {lang === "en" ? "Expired" : "หมดอายุ"}
                            </span>
                          ) : missingReport ? (
                            <span
                              className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-[#FDE7DA] text-[#B4541A]"
                              title={`${currentMonth}/${currentYear} - ยังไม่มี Report`}
                            >
                              <FaFileCircleXmark className="text-xs" aria-label="ยังไม่มี Report" />
                            </span>
                          ) : (
                            <span className="text-faint-ink" aria-label="มี Report แล้ว">
                              <FaCircleCheck className="text-emerald-500" />
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3.5 text-muted-ink">
                          {client.website_url ? (
                            <a href={client.website_url} target="_blank" rel="noopener noreferrer"
                              className="hover:text-ink hover:underline underline-offset-2 transition-colors max-w-[200px] truncate block">
                              {client.website_url.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                            </a>
                          ) : <span className="text-faint-ink">—</span>}
                        </td>
                        <td className="px-5 py-3.5">
                          <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-0.5 rounded-full ${styles.badge}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${styles.dot}`} />
                            {t(packageKeys[client.package])}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-muted-ink text-sm">
                          {client.contract_end ?? <span className="text-muted-ink text-xs">{t("settings_contract_no_expiry")}</span>}
                        </td>
                        <td className="px-5 py-3.5">
                          {client.first_login_at ? (
                            <div>
                              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />{t("admin_login_status_activated")}
                              </span>
                              <p className="text-[11px] text-muted-ink mt-1">{formatRelativeTime(client.first_login_at, lang)}</p>
                            </div>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#FFF6C2] px-2.5 py-0.5 text-xs font-semibold text-[#6B5B00] whitespace-nowrap">
                              <span className="h-1.5 w-1.5 rounded-full bg-[#B89B00]" />{t("admin_login_status_pending")}
                            </span>
                          )}
                        </td>
                        {!isCoAdmin && (
                          <td className="px-3 py-3.5 text-center">
                            <BackupConnectedIcon path={client.backup_path} t={t} />
                          </td>
                        )}
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
            <div className="lg:hidden divide-y divide-[#F4F2EC]">
              {filtered.map((client) => {
                const styles = packageStyles[client.package];
                const initials = getInitials(client.company_name);
                const missingReport = !client.has_monthly_report;
                const hideReport = client.contract_expired;
                return (
                  <div key={client.id} className="p-4 space-y-3">
                    {/* Top: avatar + name + report status */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-paper text-ink text-xs font-semibold`}>{initials}</span>
                        <div className="min-w-0">
                          <p className="font-medium text-ink text-sm truncate">{client.company_name}</p>
                          {client.website_url && (
                            <a href={client.website_url} target="_blank" rel="noopener noreferrer"
                              className="text-xs text-muted-ink hover:text-ink-soft hover:underline underline-offset-2 truncate block max-w-[200px]">
                              {client.website_url.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                            </a>
                          )}
                        </div>
                      </div>
                      {hideReport ? (
                        <span className="rounded-full bg-paper px-2.5 py-0.5 text-xs font-semibold text-muted-ink whitespace-nowrap">
                          {lang === "en" ? "Expired" : "หมดอายุ"}
                        </span>
                      ) : missingReport ? (
                        <span
                          className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-[#FDE7DA] text-[#B4541A]"
                          title={`${currentMonth}/${currentYear} - ยังไม่มี Report`}
                        >
                          <FaFileCircleXmark className="text-xs" aria-label="ยังไม่มี Report" />
                        </span>
                      ) : (
                        <span className="text-emerald-500" aria-label="มี Report แล้ว">
                          <FaCircleCheck className="text-sm" />
                        </span>
                      )}
                    </div>

                    {/* Package badge */}
                    <div className="flex items-center gap-3">
                      <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-0.5 rounded-full ${styles.badge}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${styles.dot}`} />
                        {t(packageKeys[client.package])}
                      </span>
                    </div>

                    {/* Meta row */}
                    <div className="flex items-center gap-3 flex-wrap">
                      {client.first_login_at ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />{t("admin_login_status_activated")}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#FFF6C2] px-2.5 py-0.5 text-xs font-semibold text-[#6B5B00] whitespace-nowrap">
                          <span className="h-1.5 w-1.5 rounded-full bg-[#B89B00]" />{t("admin_login_status_pending")}
                        </span>
                      )}
                      {client.contract_end && (
                        <span className="text-xs text-muted-ink">{t("admin_col_contract")}: {client.contract_end}</span>
                      )}
                      {!isCoAdmin && (
                        <BackupConnectedIcon path={client.backup_path} t={t} />
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
          <div className="border-t border-line-soft px-5 py-3">
            <p className="text-xs text-muted-ink">แสดง {filtered.length} จาก {total} รายการ</p>
          </div>
        )}
        <Pagination page={page} totalPages={totalPages} extra={contractFilter === "active" ? undefined : `contract=${contractFilter}`} />
      </div>
    </div>
  );
}
