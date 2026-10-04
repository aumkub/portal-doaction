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

      {/* ── Month progress ── */}
      <div className="grid gap-3 lg:grid-cols-[1.2fr_2fr]">
        <div className="rounded-[24px] bg-ink p-7 text-white">
          <p className="text-sm text-white/60">{L("ความคืบหน้าเดือนนี้", "This month's progress")}</p>
          <p className="mt-2 font-display text-[56px] leading-none font-bold tracking-[-0.03em] tabular-nums text-brand-yellow">
            {done}<span className="text-[28px] text-white/40">/{ms.totalClients}</span>
          </p>
          <p className="mt-2 text-sm text-white/70">{L("ส่งถึงลูกค้าแล้ว", "delivered to clients")} · {pct}%</p>
          <div className="mt-5 flex h-1.5 gap-1 overflow-hidden rounded-full">
            {ms.totalClients > 0 && (
              <>
                <span className="bg-brand-yellow" style={{ flexGrow: ms.sent }} />
                <span className="bg-emerald-400" style={{ flexGrow: ms.published }} />
                <span className="bg-white/40" style={{ flexGrow: ms.draft }} />
                <span className="bg-white/10" style={{ flexGrow: ms.none }} />
              </>
            )}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {kpis.map((k) => (
            <button key={k.key} type="button"
              onClick={() => k.key !== "none" && setStatusFilter(statusFilter === k.key ? "all" : (k.key as RowState))}
              className={`rounded-[20px] border bg-white p-5 text-left transition-colors ${statusFilter === k.key ? "border-ink" : "border-line hover:border-ink/30"} ${k.key === "none" ? "cursor-default" : ""}`}>
              <StatePill state={k.key} label={k.label} />
              <p className="mt-3 font-display text-[34px] leading-none font-bold tracking-[-0.03em] tabular-nums text-ink">{k.value}</p>
              <p className="mt-1.5 text-xs text-muted-ink">{k.hint}</p>
            </button>
          ))}
        </div>
      </div>

      {/* ── Bulk result banner ── */}
      {(bulkResult.created > 0 || bulkResult.failed > 0) && (
        <div className="rounded-[20px] border border-line bg-white px-5 py-3.5 text-sm text-ink-soft">
          {`${t("admin_reports_bulk_result_prefix")} ${bulkResult.created} ${t("admin_reports_bulk_result_created")} · ${bulkResult.failed} ${t("admin_reports_bulk_result_failed")}`}
        </div>
      )}

      {/* ── Clients still missing a report ── */}
      {missingClients.length > 0 && !isCoAdmin && (
        <div className="rounded-[20px] border border-line bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[16px] font-semibold text-ink">{L(`ยังไม่มี Report ของ ${periodLabel}`, `No report yet for ${periodLabel}`)}</p>
            <a href="/admin/reports/new" className="text-[13px] font-semibold text-ink underline-offset-4 hover:underline">
              {t("admin_reports_new_btn").replace(/^\+\s*/, "")} →
            </a>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {missingClients.map((c) => (
              <span key={c.id} className="inline-flex items-center gap-2 rounded-full bg-paper py-1 pl-1 pr-3 text-[13px] text-ink-soft">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white text-[10px] font-semibold text-ink">{getInitials(c.company_name)}</span>
                {c.company_name}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Filters ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <FaMagnifyingGlass className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-xs text-faint-ink" />
          <input
            type="search"
            placeholder={L("ค้นหาบริษัท...", "Search company...")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-10 w-full rounded-xl border border-line bg-white pl-9 pr-3.5 text-sm text-ink placeholder:text-faint-ink focus:border-ink/40 focus:outline-none focus:ring-2 focus:ring-ink/10"
          />
        </div>
        <div className="inline-flex self-start overflow-x-auto rounded-full bg-paper p-[3px] max-w-full">
          {filterOptions.map((s) => (
            <button key={s} type="button" onClick={() => setStatusFilter(s)}
              className={`h-8 shrink-0 rounded-full px-3.5 text-[13px] font-medium transition-colors ${statusFilter === s ? "bg-white text-ink shadow-[0_1px_2px_rgba(0,0,0,0.08)]" : "text-muted-ink hover:text-ink"}`}>
              {s === "all" ? L("ทั้งหมด", "All") : stateLabel(s)}
            </button>
          ))}
        </div>
      </div>

      <ReportCustomerEmailDialog
        report={emailDialog?.report ?? null}
        open={emailDialog != null}
        onOpenChange={(open) => { if (!open) setEmailDialog(null); }}
        mode={emailDialog?.mode ?? "send"}
      />

      {/* ── List ── */}
      <div className="overflow-hidden rounded-[20px] border border-line bg-white">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-5 py-16 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-paper text-muted-ink"><FaFileLines /></span>
            <p className="font-semibold text-ink">{search || statusFilter !== "all" ? L("ไม่พบ Report ที่ค้นหา", "No matching reports") : t("admin_reports_empty")}</p>
            {!isCoAdmin && !search && statusFilter === "all" && (
              <a href="/admin/reports/new" className="inline-flex h-10 items-center rounded-full bg-ink px-5 text-[13px] font-semibold text-white hover:bg-black">
                {t("admin_reports_new_btn").replace(/^\+\s*/, "")}
              </a>
            )}
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <table className="hidden w-full text-sm md:table">
              <thead>
                <tr className="border-b border-line-soft">
                  <th className="px-5 py-3 text-left text-xs font-medium text-muted-ink">{t("admin_col_client")}</th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-muted-ink">{t("admin_reports_col_month")}</th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-muted-ink">{t("admin_reports_col_tasks_short")}</th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-muted-ink">{t("admin_reports_col_status")}</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((report) => {
                  const st = rowState(report);
                  return (
                    <tr key={report.id} className="border-b border-[#F4F2EC] last:border-0 hover:bg-paper/50">
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-paper text-xs font-semibold text-ink">{getInitials(report.company_name)}</span>
                          <span className="font-medium text-ink">{report.company_name}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-ink-soft">{formatReportPeriod(report.month, report.year)}</td>
                      <td className="px-5 py-3.5 tabular-nums text-muted-ink">{report.total_tasks} {t("items")}</td>
                      <td className="px-5 py-3.5">
                        <StatePill state={st} label={stateLabel(st)} />
                        <EmailMeta report={report} lang={lang} />
                      </td>
                      <td className="px-5 py-3.5">
                        <RowActions report={report} isCoAdmin={isCoAdmin} t={t} L={L} onDialog={setEmailDialog} telegramSending={telegramSending} onTelegram={sendTelegram} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Phone cards */}
            <div className="md:hidden">
              {filtered.map((report) => {
                const st = rowState(report);
                return (
                  <div key={report.id} className="space-y-3 border-b border-[#F4F2EC] px-5 py-4 last:border-0">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-paper text-xs font-semibold text-ink">{getInitials(report.company_name)}</span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-ink">{report.company_name}</p>
                          <p className="text-xs text-muted-ink">{formatReportPeriod(report.month, report.year)} · {report.total_tasks} {t("items")}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <StatePill state={st} label={stateLabel(st)} />
                      </div>
                    </div>
                    <EmailMeta report={report} lang={lang} />
                    <RowActions report={report} isCoAdmin={isCoAdmin} t={t} L={L} onDialog={setEmailDialog} telegramSending={telegramSending} onTelegram={sendTelegram} />
                  </div>
                );
              })}
            </div>
          </>
        )}

        {filtered.length > 0 && (
          <div className="border-t border-line-soft px-5 py-2.5">
            <p className="text-xs text-muted-ink">{L(`แสดง ${filtered.length} จาก ${reports.length} รายการ`, `Showing ${filtered.length} of ${reports.length}`)}</p>
          </div>
        )}
        <Pagination page={page} totalPages={totalPages} />
      </div>
    </div>
  );
}
