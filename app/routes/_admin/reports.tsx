import { useState, useMemo } from "react";
import { needsMonthlyReport } from "~/lib/contract";
import { useRevalidator } from "react-router";
import type { Route } from "./+types/reports";
import Pagination from "~/components/ui/Pagination";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { requireCoAdminOrAdmin } from "~/lib/auth.server";
import ReportCustomerEmailDialog, {
  type ReportRowForEmail,
} from "~/components/reports/ReportCustomerEmailDialog";
import { createDB } from "~/lib/db.server";
import { formatDate, formatRelativeTime, getMonthName } from "~/lib/utils";
import { useT } from "~/lib/i18n";
import {
  FaEye,
  FaFileCirclePlus,
  FaPaperPlane,
  FaRotateRight,
  FaPenToSquare,
  FaMagnifyingGlass,
  FaFileLines,
  FaCircleCheck,
  FaTelegram,
  FaEllipsis,
} from "react-icons/fa6";

export function meta() {
  return [{ title: "จัดการ Report — Admin" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const user = await requireCoAdminOrAdmin(request, env.DB, env.SESSIONPORTAL);
  const db = createDB(env.DB);

  let assignedClientIds: string[] | undefined;
  if (user.role === "co-admin") {
    const assignments = await db.listCoAdminClients(user.id);
    assignedClientIds = assignments.map((a) => a.client_id);
  }

  const [allClients, allReports] = await Promise.all([
    db.listClients(),
    db.listRecentReportsWithClient(3, assignedClientIds),
  ]);
  // Expired contracts and our own company get no monthly report, so leave
  // them out of this month's progress and the "not created yet" list.
  const clients = (assignedClientIds
    ? allClients.filter((c) => assignedClientIds.includes(c.id))
    : allClients
  ).filter(needsMonthlyReport);
  const activeIds = new Set(clients.map((c) => c.id));

  const url = new URL(request.url);
  const bulkCreated = Number(url.searchParams.get("bulkCreated") ?? "0");
  const bulkFailed = Number(url.searchParams.get("bulkFailed") ?? "0");
  const PAGE_SIZE = 20;
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1"));
  const total = allReports.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const reports = allReports.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  // Current-month progress across every visible client
  const now = new Date();
  const curMonth = now.getMonth() + 1;
  const curYear = now.getFullYear();
  const thisMonth = allReports.filter(
    (r) => r.month === curMonth && r.year === curYear && activeIds.has(r.client_id)
  );
  const withReport = new Set(thisMonth.map((r) => r.client_id));
  const missingClients = clients
    .filter((c) => !withReport.has(c.id))
    .map((c) => ({ id: c.id, company_name: c.company_name }));
  const monthStats = {
    month: curMonth,
    year: curYear,
    totalClients: clients.length,
    none: missingClients.length,
    draft: thisMonth.filter((r) => r.status === "draft").length,
    published: thisMonth.filter((r) => r.status === "published" && r.client_notified_at == null).length,
    sent: thisMonth.filter((r) => r.status === "published" && r.client_notified_at != null).length,
  };

  return {
    reports,
    clients,
    monthStats,
    missingClients,
    userRole: user.role,
    page: safePage,
    totalPages,
    bulkResult: {
      created: Number.isNaN(bulkCreated) ? 0 : bulkCreated,
      failed: Number.isNaN(bulkFailed) ? 0 : bulkFailed,
    },
  };
}

type RowState = "draft" | "published" | "sent";

function rowState(r: ReportRowForEmail): RowState {
  if (r.status !== "published") return "draft";
  return r.client_notified_at != null ? "sent" : "published";
}

const pillCls: Record<RowState | "none", string> = {
  none: "bg-paper text-muted-ink",
  draft: "bg-[#FFF6C2] text-[#6B5B00]",
  published: "bg-emerald-50 text-emerald-700",
  sent: "bg-ink text-white",
};

function getInitials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

type ReportDialogSetter = (v: { report: ReportRowForEmail; mode: "send" | "view" } | null) => void;

function StatePill({ state, label }: { state: RowState | "none"; label: string }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${pillCls[state]}`}>
      {label}
    </span>
  );
}

function EmailMeta({ report, lang }: { report: ReportRowForEmail; lang: string }) {
  if (report.client_notified_at == null) return null;
  return (
    <p className="text-[11px] text-faint-ink mt-1">
      {formatRelativeTime(report.client_notified_at, lang as any)} · {formatDate(report.client_notified_at, lang as any)}
    </p>
  );
}

/** One primary action per row, the rest tucked into an overflow menu. */
function RowActions({ report, isCoAdmin, t, L, onDialog, telegramSending, onTelegram }: {
  report: ReportRowForEmail; isCoAdmin: boolean; t: (k: any) => string;
  L: (th: string, en: string) => string; onDialog: ReportDialogSetter;
  telegramSending: string | null; onTelegram: (id: string) => void;
}) {
  const isPublished = report.status === "published";
  const notified = report.client_notified_at != null;
  const telegramSent = report.telegram_notified_at != null;
  const sending = telegramSending === report.id;

  const pillBase = "inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-[13px] font-semibold transition-colors whitespace-nowrap";
  let primary: React.ReactNode;
  if (!isCoAdmin && isPublished && !notified) {
    primary = (
      <button type="button" onClick={() => onDialog({ report, mode: "send" })} className={`${pillBase} bg-ink text-white hover:bg-black`}>
        <FaPaperPlane className="text-[11px]" />{t("admin_report_email_btn_send")}
      </button>
    );
  } else if (!isCoAdmin && !isPublished) {
    primary = (
      <a href={`/admin/reports/${report.id}`} className={`${pillBase} border border-line bg-white text-ink hover:bg-paper`}>
        <FaPenToSquare className="text-[11px]" />{t("admin_reports_edit")}
      </a>
    );
  } else {
    primary = (
      <a href={`/reports/${report.id}`} target="_blank" rel="noopener noreferrer" className={`${pillBase} border border-line bg-white text-ink hover:bg-paper`}>
        <FaMagnifyingGlass className="text-[11px]" />{t("admin_reports_preview")}
      </a>
    );
  }

  return (
    <div className="flex items-center justify-end gap-1.5">
      {primary}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label={L("การดำเนินการอื่น", "More actions")}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-line bg-white text-muted-ink hover:bg-paper hover:text-ink">
            <FaEllipsis />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[200px] rounded-xl border-line">
          <DropdownMenuItem asChild>
            <a href={`/reports/${report.id}`} target="_blank" rel="noopener noreferrer">
              <FaMagnifyingGlass />{t("admin_reports_preview")}
            </a>
          </DropdownMenuItem>
          {!isCoAdmin && (
            <DropdownMenuItem asChild>
              <a href={`/admin/reports/${report.id}`}><FaPenToSquare />{t("admin_reports_edit")}</a>
            </DropdownMenuItem>
          )}
          {!isCoAdmin && isPublished && (
            <>
              <DropdownMenuSeparator />
              {notified ? (
                <>
                  <DropdownMenuItem onSelect={() => onDialog({ report, mode: "view" })}>
                    <FaEye />{t("admin_report_email_btn_view")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => onDialog({ report, mode: "send" })}>
                    <FaRotateRight />{t("admin_report_email_btn_resend")}
                  </DropdownMenuItem>
                </>
              ) : (
                <DropdownMenuItem onSelect={() => onDialog({ report, mode: "send" })}>
                  <FaPaperPlane />{t("admin_report_email_btn_send")}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem disabled={sending} onSelect={() => onTelegram(report.id)}>
                <FaTelegram />
                {sending ? "..." : telegramSent ? t("admin_report_telegram_btn_resend") : t("admin_report_telegram_btn_send")}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** Pipeline order and colours for this month's report stages. */
const STAGES = [
  { key: "none", dot: "bg-[#D9D6CC]", bar: "bg-[#D9D6CC]" },
  { key: "draft", dot: "bg-brand-yellow", bar: "bg-brand-yellow" },
  { key: "published", dot: "bg-emerald-500", bar: "bg-emerald-500" },
  { key: "sent", dot: "bg-ink", bar: "bg-ink" },
] as const;

export default function AdminReportsPage({ loaderData }: Route.ComponentProps) {
  const { reports, bulkResult, userRole, page, totalPages, monthStats, missingClients } = loaderData as {
    reports: ReportRowForEmail[];
    bulkResult: { created: number; failed: number };
    userRole: "admin" | "co-admin";
    page: number;
    totalPages: number;
    monthStats: { month: number; year: number; totalClients: number; none: number; draft: number; published: number; sent: number };
    missingClients: { id: string; company_name: string }[];
  };
  const { t, lang } = useT();
  const L = (th: string, en: string) => (lang === "en" ? en : th);
  const isCoAdmin = userRole === "co-admin";

  const revalidator = useRevalidator();
  const [emailDialog, setEmailDialog] = useState<{ report: ReportRowForEmail; mode: "send" | "view" } | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | RowState>("all");
  const [telegramSending, setTelegramSending] = useState<string | null>(null);

  async function sendTelegram(reportId: string) {
    setTelegramSending(reportId);
    try {
      const fd = new FormData();
      fd.append("reportId", reportId);
      await fetch("/api/report-telegram-notify", { method: "POST", body: fd });
      revalidator.revalidate();
    } finally {
      setTelegramSending(null);
    }
  }

  const formatReportPeriod = (month: number, year: number) => {
    const m = getMonthName(month, lang);
    return lang === "en" ? `${m} ${year}` : `${m} ${year + 543}`;
  };

  const stateLabel = (s: RowState | "none") =>
    s === "none" ? L("ยังไม่สร้าง", "Not started")
    : s === "draft" ? t("admin_report_status_draft")
    : s === "published" ? t("admin_report_status_published")
    : t("admin_report_email_badge_sent");

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return reports.filter((r) => {
      const matchesSearch = !q || r.company_name.toLowerCase().includes(q);
      const matchesStatus = statusFilter === "all" || rowState(r) === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [reports, search, statusFilter]);

  // Group the filtered rows under report-month headings.
  const groups: { key: string; label: string; rows: ReportRowForEmail[] }[] = [];
  for (const r of filtered) {
    const key = `${r.year}-${r.month}`;
    const last = groups[groups.length - 1];
    if (last?.key === key) last.rows.push(r);
    else groups.push({ key, label: formatReportPeriod(r.month, r.year), rows: [r] });
  }

  const ms = monthStats;
  const done = ms.sent;
  const pct = ms.totalClients > 0 ? Math.round((done / ms.totalClients) * 100) : 0;
  const remaining = ms.none + ms.draft + ms.published;
  const periodLabel = formatReportPeriod(ms.month, ms.year);

  const kpis: { key: RowState | "none"; label: string; value: number; hint: string }[] = [
    { key: "none", label: stateLabel("none"), value: ms.none, hint: L("ลูกค้าที่ยังไม่มี Report", "Clients without a report") },
    { key: "draft", label: stateLabel("draft"), value: ms.draft, hint: L("กำลังเขียน", "Being written") },
    { key: "published", label: stateLabel("published"), value: ms.published, hint: L("รอส่งอีเมลลูกค้า", "Waiting to email client") },
    { key: "sent", label: stateLabel("sent"), value: ms.sent, hint: L("ส่งถึงลูกค้าแล้ว", "Delivered to client") },
  ];

  const filterOptions: ("all" | RowState)[] = ["all", "draft", "published", "sent"];

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-muted-ink">{t("admin_reports_page_title")} · {periodLabel}</p>
          <h1 className="mt-1 text-[28px] md:text-[32px] font-bold tracking-[-0.02em] text-ink">
            {remaining === 0 && ms.totalClients > 0
              ? L(`Report เดือนนี้ส่งครบแล้ว`, `All reports sent this month`)
              : L(`เหลืออีก ${remaining} Report ที่ต้องส่งเดือนนี้`, `${remaining} report${remaining === 1 ? "" : "s"} left to send this month`)}
          </h1>
        </div>
        {!isCoAdmin && (
          <a href="/admin/reports/new"
            className="inline-flex h-10 items-center gap-2 self-start rounded-full bg-ink px-5 text-[13px] font-semibold text-white hover:bg-black sm:self-auto">
            <FaFileCirclePlus aria-hidden="true" />
            {t("admin_reports_new_btn").replace(/^\+\s*/, "")}
          </a>
        )}
      </div>

      {/* ── Month progress: one card, read left → right as a pipeline ── */}
      <section className="overflow-hidden rounded-[24px] border border-line bg-white">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 px-5 pt-5 md:px-7 md:pt-6">
          <div className="min-w-0">
            <p className="text-sm text-muted-ink">{L("ส่งถึงลูกค้าแล้ว", "Delivered to clients")}</p>
            <p className="mt-1 font-display text-[44px] leading-none font-bold tracking-[-0.03em] tabular-nums text-ink">
              {done}
              <span className="text-[24px] text-faint-ink">/{ms.totalClients}</span>
            </p>
          </div>
          <p className="font-display text-[22px] font-bold tabular-nums text-ink">{pct}%</p>
        </div>

        {/* Stacked bar: each stage's share of this month's clients */}
        <div className="px-5 pb-5 pt-4 md:px-7 md:pb-6" aria-hidden="true">
          <div className="flex h-2.5 gap-[3px] overflow-hidden rounded-full bg-paper">
            {ms.totalClients > 0 &&
              STAGES.map((st) => {
                const n = kpis.find((k) => k.key === st.key)?.value ?? 0;
                return n > 0 ? <span key={st.key} className={st.bar} style={{ flexGrow: n }} /> : null;
              })}
          </div>
        </div>

        {/* Stages — click to filter the list below */}
        <div className="grid grid-cols-2 border-t border-line-soft sm:grid-cols-4">
          {kpis.map((k, idx) => {
            const st = STAGES.find((x) => x.key === k.key)!;
            const active = statusFilter === k.key;
            const clickable = k.key !== "none";
            return (
              <button
                key={k.key}
                type="button"
                disabled={!clickable}
                aria-pressed={clickable ? active : undefined}
                onClick={() => clickable && setStatusFilter(active ? "all" : (k.key as RowState))}
                className={`relative min-w-0 px-5 py-4 text-left transition-colors md:px-6 ${
                  idx % 2 === 1 ? "border-l border-line-soft" : ""
                } ${idx >= 2 ? "border-t border-line-soft sm:border-t-0" : ""} ${
                  idx === 2 ? "sm:border-l" : ""
                } ${active ? "bg-paper" : clickable ? "hover:bg-paper/60" : "cursor-default"}`}
              >
                {active && <span className="absolute inset-x-0 top-0 h-[3px] bg-ink" />}
                <span className="flex min-w-0 items-center gap-2">
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${st.dot}`} />
                  <span className="truncate text-[13px] font-semibold text-ink">{k.label}</span>
                </span>
                <span className="mt-2 block font-display text-[30px] leading-none font-bold tracking-[-0.03em] tabular-nums text-ink">
                  {k.value}
                </span>
                <span className="mt-1.5 block text-xs leading-snug text-muted-ink">{k.hint}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* ── Bulk result banner ── */}
      {(bulkResult.created > 0 || bulkResult.failed > 0) && (
        <div className="rounded-[20px] border border-line bg-white px-5 py-3.5 text-sm text-ink-soft">
          {`${t("admin_reports_bulk_result_prefix")} ${bulkResult.created} ${t("admin_reports_bulk_result_created")} · ${bulkResult.failed} ${t("admin_reports_bulk_result_failed")}`}
        </div>
      )}

      {/* ── Clients still missing a report ── */}
      {missingClients.length > 0 && !isCoAdmin && (
        <section className="rounded-[20px] border border-line bg-white px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <p className="min-w-0 truncate text-sm font-semibold text-ink">
              {L(`ยังไม่มี Report ของเดือนนี้`, `No report yet this month`)}
              <span className="ml-1.5 font-normal text-muted-ink">· {missingClients.length}</span>
            </p>
            <a href="/admin/reports/new"
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-brand-yellow px-3.5 text-[13px] font-semibold text-ink hover:brightness-95">
              <FaFileCirclePlus className="text-[11px]" aria-hidden="true" />
              {t("admin_reports_new_btn").replace(/^\+\s*/, "")}
            </a>
          </div>
          <div className="-mx-5 mt-3 flex gap-2 overflow-x-auto px-5 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0">
            {missingClients.map((c) => (
              <span key={c.id} className="inline-flex max-w-[220px] shrink-0 items-center gap-2 rounded-full bg-paper py-1 pl-1 pr-3 text-[13px] text-ink-soft">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-[10px] font-semibold text-ink">{getInitials(c.company_name)}</span>
                <span className="truncate">{c.company_name}</span>
              </span>
            ))}
          </div>
        </section>
      )}

      <ReportCustomerEmailDialog
        report={emailDialog?.report ?? null}
        open={emailDialog != null}
        onOpenChange={(open) => { if (!open) setEmailDialog(null); }}
        mode={emailDialog?.mode ?? "send"}
      />

      {/* ── List ── */}
      <section className="overflow-hidden rounded-[20px] border border-line bg-white">
        <div className="flex flex-col gap-3 border-b border-line-soft px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative min-w-0 sm:max-w-xs sm:flex-1">
            <FaMagnifyingGlass className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-xs text-faint-ink" />
            <input
              type="search"
              placeholder={L("ค้นหาบริษัท...", "Search company...")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 w-full rounded-full border border-line bg-white pl-9 pr-3.5 text-sm text-ink placeholder:text-faint-ink focus:border-ink/40 focus:outline-none focus:ring-2 focus:ring-ink/10"
            />
          </div>
          <div className="-mx-5 overflow-x-auto px-5 sm:mx-0 sm:px-0">
            <div className="inline-flex rounded-full bg-paper p-[3px]">
              {filterOptions.map((s) => (
                <button key={s} type="button" aria-pressed={statusFilter === s} onClick={() => setStatusFilter(s)}
                  className={`flex h-8 shrink-0 items-center whitespace-nowrap rounded-full px-3.5 text-[13px] font-medium ${statusFilter === s ? "bg-white text-ink shadow-[0_1px_2px_rgba(0,0,0,0.08)]" : "text-muted-ink hover:text-ink"}`}>
                  {s === "all" ? L("ทั้งหมด", "All") : stateLabel(s)}
                </button>
              ))}
            </div>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="px-5 py-14 text-center">
            <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-paper text-ink-soft"><FaFileLines /></span>
            <p className="text-sm text-muted-ink">{search || statusFilter !== "all" ? L("ไม่พบ Report ที่ค้นหา", "No matching reports") : t("admin_reports_empty")}</p>
            {!isCoAdmin && !search && statusFilter === "all" && (
              <a href="/admin/reports/new" className="mt-4 inline-flex h-10 items-center rounded-full bg-ink px-5 text-[13px] font-semibold text-white hover:bg-black">
                {t("admin_reports_new_btn").replace(/^\+\s*/, "")}
              </a>
            )}
          </div>
        ) : (
          groups.map((g) => (
            <div key={g.key}>
              <p className="sticky top-0 z-[1] border-b border-line-soft bg-paper/80 px-5 py-2 text-xs font-semibold text-muted-ink backdrop-blur">
                {g.label}
              </p>
              <ul className="divide-y divide-[#F4F2EC]">
                {g.rows.map((report) => {
                  const st = rowState(report);
                  const href = isCoAdmin ? `/reports/${report.id}` : `/admin/reports/${report.id}`;
                  return (
                    <li key={report.id} className="flex min-w-0 flex-col gap-2.5 px-5 py-3.5 hover:bg-paper/60 sm:flex-row sm:items-center sm:gap-3.5">
                      <a href={href} {...(isCoAdmin ? { target: "_blank", rel: "noopener noreferrer" } : {})} className="flex min-w-0 flex-1 items-center gap-3.5">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] bg-paper text-xs font-semibold text-ink">{getInitials(report.company_name)}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-ink">{report.company_name}</span>
                          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-ink">
                            <span className="truncate">{report.title || formatReportPeriod(report.month, report.year)}</span>
                            <span aria-hidden="true">·</span>
                            <span className="shrink-0 tabular-nums">{report.total_tasks} {t("items")}</span>
                          </span>
                          <EmailMeta report={report} lang={lang} />
                        </span>
                        <span className="shrink-0 sm:hidden"><StatePill state={st} label={stateLabel(st)} /></span>
                      </a>
                      <div className="flex shrink-0 items-center justify-end gap-3">
                        <span className="hidden sm:inline-flex"><StatePill state={st} label={stateLabel(st)} /></span>
                        <RowActions report={report} isCoAdmin={isCoAdmin} t={t} L={L} onDialog={setEmailDialog} telegramSending={telegramSending} onTelegram={sendTelegram} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}

        {filtered.length > 0 && (
          <div className="border-t border-line-soft px-5 py-2.5">
            <p className="text-xs text-muted-ink">{L(`แสดง ${filtered.length} จาก ${reports.length} รายการ`, `Showing ${filtered.length} of ${reports.length}`)}</p>
          </div>
        )}
        <Pagination page={page} totalPages={totalPages} />
      </section>
    </div>
  );
}
