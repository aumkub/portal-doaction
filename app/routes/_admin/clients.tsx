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

function daysUntil(end: string | null): number | null {
  if (!end) return null;
  const ms = Date.parse(`${end}T23:59:59+07:00`);
  if (Number.isNaN(ms)) return null;
  return Math.ceil((ms - Date.now()) / 86400000);
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
  const L = (th: string, en: string) => (lang === "en" ? en : th);
  const [search, setSearch] = useState("");
  const [reportFilter, setReportFilter] = useState<"all" | "missing" | "has">("all");
  const [loginFilter, setLoginFilter] = useState<"all" | "activated" | "pending">("all");

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
      const matchesLogin =
        loginFilter === "all" ||
        (loginFilter === "activated" && !!c.first_login_at) ||
        (loginFilter === "pending" && !c.first_login_at);
      return matchesSearch && matchesReport && matchesLogin;
    });
  }, [clients, search, reportFilter, loginFilter]);

  const isCoAdmin = userRole === "co-admin";

  const contractCards = [
    { value: "active" as const, label: L("ใช้งานอยู่", "Active"), count: activeCount, chip: "bg-emerald-50 text-emerald-700", icon: FaCircleCheck },
    { value: "expired" as const, label: L("หมดอายุ", "Expired"), count: expiredCount, chip: "bg-[#FDE7DA] text-[#B4541A]", icon: FaClock },
    { value: "all" as const, label: L("ทั้งหมด", "All"), count: activeCount + expiredCount, chip: "bg-paper text-ink-soft", icon: FaUsers },
  ];

  const segBtn = (on: boolean) =>
    `flex h-8 items-center rounded-full px-3.5 text-[13px] font-medium whitespace-nowrap ${
      on ? "bg-white text-ink shadow-[0_1px_2px_rgba(0,0,0,0.08)]" : "text-muted-ink hover:text-ink"
    }`;

  return (
    <div className="space-y-6">
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

      {/* ── Contract filter cards ── */}
      <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 sm:pb-0">
        {contractCards.map((c) => {
          const active = contractFilter === c.value;
          return (
            <a
              key={c.value}
              href={c.value === "active" ? "/admin/clients" : `/admin/clients?contract=${c.value}`}
              aria-current={active ? "page" : undefined}
              className={`w-[148px] shrink-0 rounded-[18px] border bg-white p-4 transition-colors sm:w-auto sm:min-w-0 ${
                active ? "border-ink ring-1 ring-ink" : "border-line hover:border-ink/30"
              }`}
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] ${c.chip}`}>
                  <c.icon className="text-[12px]" aria-hidden="true" />
                </span>
                <span className="truncate text-[13px] font-semibold text-ink">{c.label}</span>
              </span>
              <span className="mt-2 block font-display text-[28px] leading-none font-bold tabular-nums text-ink">{c.count}</span>
            </a>
          );
        })}
      </div>

      {/* ── List ── */}
      <section className="overflow-hidden rounded-[20px] border border-line bg-white">
        <div className="space-y-3 border-b border-line-soft px-5 py-3.5">
          <div className="relative">
            <FaMagnifyingGlass className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-faint-ink text-xs" />
            <input
              type="search"
              placeholder="ค้นหาบริษัท หรือเว็บไซต์..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full h-10 rounded-full border border-line bg-white pl-9 pr-3.5 text-sm text-ink placeholder:text-faint-ink focus:outline-none focus:ring-2 focus:ring-ink/10 focus:border-ink/40 transition"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex max-w-full overflow-x-auto rounded-full bg-paper p-[3px]">
              {([
                { v: "all" as const, label: L("ทั้งหมด", "All") },
                { v: "missing" as const, label: L("ยังไม่มี Report", "No report") },
                { v: "has" as const, label: L("มี Report แล้ว", "Has report") },
              ]).map((o) => (
                <button key={o.v} type="button" onClick={() => setReportFilter(o.v)} className={segBtn(reportFilter === o.v)}>
                  {o.label}
                </button>
              ))}
            </div>
            <div className="inline-flex max-w-full overflow-x-auto rounded-full bg-paper p-[3px]">
              {([
                { v: "all" as const, label: L("ทุกสถานะ", "Any login") },
                { v: "activated" as const, label: t("admin_login_status_activated") },
                { v: "pending" as const, label: t("admin_login_status_pending") },
              ]).map((o) => (
                <button key={o.v} type="button" onClick={() => setLoginFilter(o.v)} className={segBtn(loginFilter === o.v)}>
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="px-5 py-14 text-center">
            <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-paper text-ink-soft">
              <FaUsers />
            </span>
            <p className="text-sm text-muted-ink">
              {search || reportFilter !== "all" || loginFilter !== "all" ? "ไม่พบลูกค้าที่ค้นหา" : t("admin_clients_empty")}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-line-soft">
            {filtered.map((client) => {
              const styles = packageStyles[client.package];
              const days = daysUntil(client.contract_end);
              const endingSoon = !client.contract_expired && days !== null && days <= 30;
              const site = client.website_url?.replace(/^https?:\/\//, "").replace(/\/$/, "");
              return (
                <li key={client.id} className="flex flex-col gap-3 px-5 py-3.5 hover:bg-paper/60 sm:flex-row sm:items-center">
                  <a href={`/admin/clients/${client.id}`} className="flex min-w-0 flex-1 items-center gap-3.5">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] bg-paper text-xs font-semibold text-ink">
                      {getInitials(client.company_name)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-ink">{client.company_name}</span>
                      <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-ink">
                        {site && (
                          <>
                            <span className="max-w-full truncate">{site}</span>
                            <span aria-hidden="true">·</span>
                          </>
                        )}
                        <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${styles.badge}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${styles.dot}`} />
                          {t(packageKeys[client.package])}
                        </span>
                        <span aria-hidden="true">·</span>
                        {client.contract_expired ? (
                          <span className="shrink-0 rounded-full bg-[#FDE7DA] px-2 py-0.5 text-[11px] font-semibold text-[#B4541A]">
                            {L("หมดอายุ", "Expired")} {client.contract_end}
                          </span>
                        ) : client.contract_end ? (
                          <span className={`shrink-0 tabular-nums ${endingSoon ? "font-semibold text-[#B4541A]" : ""}`}>
                            {t("admin_col_contract")}: {client.contract_end}
                            {endingSoon && days !== null ? ` (${L(`อีก ${days} วัน`, `${days}d left`)})` : ""}
                          </span>
                        ) : (
                          <span className="shrink-0">{t("settings_contract_no_expiry")}</span>
                        )}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      {client.contract_expired ? (
                        <span className="rounded-full bg-paper px-2.5 py-0.5 text-xs font-semibold text-muted-ink whitespace-nowrap">
                          {L("หมดอายุ", "Expired")}
                        </span>
                      ) : !client.has_monthly_report ? (
                        <span
                          className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-[#FDE7DA] text-[#B4541A]"
                          title={`${currentMonth}/${currentYear} - ยังไม่มี Report`}
                        >
                          <FaFileCircleXmark className="text-xs" aria-label="ยังไม่มี Report" />
                        </span>
                      ) : (
                        <span className="inline-flex h-7 w-7 items-center justify-center" aria-label="มี Report แล้ว">
                          <FaCircleCheck className="text-emerald-500" />
                        </span>
                      )}
                      {client.first_login_at ? (
                        <span
                          className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 whitespace-nowrap"
                          title={formatRelativeTime(client.first_login_at, lang)}
                        >
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />{t("admin_login_status_activated")}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-[#FFF6C2] px-2 py-0.5 text-[11px] font-semibold text-[#6B5B00] whitespace-nowrap">
                          <span className="h-1.5 w-1.5 rounded-full bg-[#B89B00]" />{t("admin_login_status_pending")}
                        </span>
                      )}
                    </span>
                  </a>
                  <div className="flex shrink-0 items-center gap-2 pl-[54px] sm:pl-0">
                    {!isCoAdmin && <BackupConnectedIcon path={client.backup_path} t={t} />}
                    <ClientActions client={client} isCoAdmin={isCoAdmin} t={t} confirmMsg={`${t("admin_impersonate_confirm")} ${client.company_name}?`} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {filtered.length > 0 && (
          <div className="border-t border-line-soft px-5 py-3">
            <p className="text-xs text-muted-ink">แสดง {filtered.length} จาก {total} รายการ</p>
          </div>
        )}
        <Pagination page={page} totalPages={totalPages} extra={contractFilter === "active" ? undefined : `contract=${contractFilter}`} />
      </section>
    </div>
  );
}
