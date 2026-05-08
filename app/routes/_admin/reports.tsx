import { useState, useMemo } from "react";
import type { Route } from "./+types/reports";
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
} from "react-icons/fa6";

export function meta() {
  return [{ title: "จัดการ Report — Admin" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const user = await requireCoAdminOrAdmin(request, env.DB, env.SESSIONPORTAL);
  const db = createDB(env.DB);

  let clients;
  if (user.role === "co-admin") {
    const assignments = await db.listCoAdminClients(user.id);
    const clientIds = assignments.map((a) => a.client_id);
    clients = (await db.listClients()).filter((c) => clientIds.includes(c.id));
  } else {
    clients = await db.listClients();
  }

  const allReports: ReportRowForEmail[] = [];
  for (const client of clients) {
    const u = await db.getUserById(client.user_id);
    const reports = await db.listReportsByClient(client.id);
    for (const r of reports.slice(0, 3)) {
      allReports.push({
        ...r,
        company_name: client.company_name,
        client_email: u?.email ?? "",
        client_contact_name: u?.name ?? "",
      });
    }
  }
  allReports.sort((a, b) => b.created_at - a.created_at);

  const url = new URL(request.url);
  const bulkCreated = Number(url.searchParams.get("bulkCreated") ?? "0");
  const bulkFailed = Number(url.searchParams.get("bulkFailed") ?? "0");

  return {
    reports: allReports.slice(0, 20),
    clients,
    userRole: user.role,
    bulkResult: {
      created: Number.isNaN(bulkCreated) ? 0 : bulkCreated,
      failed: Number.isNaN(bulkFailed) ? 0 : bulkFailed,
    },
  };
}

const statusStyle = {
  draft:     { badge: "bg-slate-100 text-slate-500 ring-1 ring-slate-200",    dot: "bg-slate-400" },
  published: { badge: "bg-emerald-50 text-emerald-600 ring-1 ring-emerald-200", dot: "bg-emerald-500" },
};

function getInitials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}
function avatarColor(name: string) {
  const colors = [
    "bg-violet-100 text-violet-700", "bg-blue-100 text-blue-700",
    "bg-emerald-100 text-emerald-700", "bg-orange-100 text-orange-700",
    "bg-rose-100 text-rose-700", "bg-indigo-100 text-indigo-700",
    "bg-teal-100 text-teal-700", "bg-pink-100 text-pink-700",
  ];
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) & 0xffff;
  return colors[hash % colors.length];
}

type ReportDialogSetter = (v: { report: ReportRowForEmail; mode: "send" | "view" } | null) => void;

function EmailStatusCell({ report, notified, isPublished, t, lang, formatRelativeTime, formatDate }: {
  report: ReportRowForEmail; notified: boolean; isPublished: boolean;
  t: (k: any) => string; lang: string;
  formatRelativeTime: (ts: number, lang: any) => string;
  formatDate: (ts: number, lang: any) => string;
}) {
  if (!isPublished) return <span className="text-xs text-slate-500">{t("admin_report_email_publish_first")}</span>;
  if (notified) return (
    <div>
      <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-50 text-violet-700 text-[11px] font-semibold px-2.5 py-1 ring-1 ring-violet-200">
        <span className="h-1.5 w-1.5 rounded-full bg-violet-500" />
        {t("admin_report_email_badge_sent")}
      </span>
      <p className="text-[11px] text-slate-500 mt-1">
        {formatRelativeTime(report.client_notified_at!, lang as any)}
        <span className="text-slate-300"> · </span>
        {formatDate(report.client_notified_at!, lang as any)}
      </p>
    </div>
  );
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 bg-amber-50 px-2.5 py-1 rounded-full ring-1 ring-amber-200">
      <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
      {t("admin_report_email_not_sent")}
    </span>
  );
}

function ActionButtons({ report, notified, isPublished, isCoAdmin, t, onDialog }: {
  report: ReportRowForEmail; notified: boolean; isPublished: boolean;
  isCoAdmin: boolean; t: (k: any) => string; onDialog: ReportDialogSetter;
}) {
  return (
    <>
      {isPublished && !isCoAdmin && (
        <>
          {!notified ? (
            <button type="button" onClick={() => onDialog({ report, mode: "send" })}
              className="inline-flex items-center gap-1.5 mr-2 rounded-lg bg-violet-600 text-white text-xs font-medium px-3 py-1.5 hover:bg-violet-700 transition-colors">
              <FaPaperPlane className="text-[10px]" />{t("admin_report_email_btn_send")}
            </button>
          ) : (
            <>
              <button type="button" onClick={() => onDialog({ report, mode: "view" })}
                className="inline-flex items-center gap-1.5 mr-2 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-600 px-3 py-1.5 hover:bg-slate-50 transition-colors">
                <FaEye className="text-[10px]" />{t("admin_report_email_btn_view")}
              </button>
              <button type="button" onClick={() => onDialog({ report, mode: "send" })}
                className="inline-flex items-center gap-1.5 mr-2 rounded-lg border border-violet-200 bg-violet-50 text-xs font-medium text-violet-700 px-3 py-1.5 hover:bg-violet-100 transition-colors">
                <FaRotateRight className="text-[10px]" />{t("admin_report_email_btn_resend")}
              </button>
            </>
          )}
        </>
      )}
      <a href={`/reports/${report.id}`} target="_blank" rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 mr-2 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-600 px-3 py-1.5 hover:bg-slate-50 transition-colors">
        <FaMagnifyingGlass className="text-[10px]" />{t("admin_reports_preview")}
      </a>
      {!isCoAdmin && (
        <a href={`/admin/reports/${report.id}`}
          className="inline-flex items-center gap-1.5 mr-2 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-600 px-3 py-1.5 hover:bg-slate-50 transition-colors">
          <FaPenToSquare className="text-[10px]" />{t("admin_reports_edit")}
        </a>
      )}
    </>
  );
}

export default function AdminReportsPage({ loaderData }: Route.ComponentProps) {
  const { reports, bulkResult, userRole } = loaderData as {
    reports: ReportRowForEmail[];
    bulkResult: { created: number; failed: number };
    userRole: "admin" | "co-admin";
  };
  const { t, lang } = useT();
  const isCoAdmin = userRole === "co-admin";

  const [emailDialog, setEmailDialog] = useState<{ report: ReportRowForEmail; mode: "send" | "view" } | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "draft" | "published">("all");

  const formatReportPeriod = (month: number, year: number) => {
    const m = getMonthName(month, lang);
    return lang === "en" ? `${m} ${year}` : `${m} ${year + 543}`;
  };

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return reports.filter((r) => {
      const matchesSearch = !q || r.company_name.toLowerCase().includes(q);
      const matchesStatus = statusFilter === "all" || r.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [reports, search, statusFilter]);

  const publishedCount = reports.filter((r) => r.status === "published").length;
  const draftCount = reports.filter((r) => r.status === "draft").length;

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{t("admin_reports_page_title")}</h1>
          <p className="text-slate-500 text-sm mt-0.5">{t("admin_reports_page_subtitle")}</p>
        </div>
        {!isCoAdmin && (
          <a
            href="/admin/reports/new"
            className="inline-flex items-center gap-2 bg-[#F0D800] text-slate-900 rounded-lg px-4 py-2.5 text-sm font-semibold hover:bg-yellow-400 transition-colors shadow-sm self-start sm:self-auto"
          >
            <FaFileCirclePlus aria-hidden="true" />
            {t("admin_reports_new_btn")}
          </a>
        )}
      </div>

      {/* ── Stats strip ── */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3.5 flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-600 shrink-0">
            <FaFileLines className="text-sm" />
          </span>
          <div>
            <p className="text-xs text-slate-500">ทั้งหมด</p>
            <p className="text-xl font-semibold text-slate-900">{reports.length}</p>
          </div>
        </div>
        <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3.5 flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-100 text-emerald-600 shrink-0">
            <FaCircleCheck className="text-sm" />
          </span>
          <div>
            <p className="text-xs text-emerald-600">{t("admin_report_status_published")}</p>
            <p className="text-xl font-semibold text-emerald-700">{publishedCount}</p>
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3.5 flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-500 shrink-0">
            <FaFileLines className="text-sm" />
          </span>
          <div>
            <p className="text-xs text-slate-500">{t("admin_report_status_draft")}</p>
            <p className="text-xl font-semibold text-slate-700">{draftCount}</p>
          </div>
        </div>
      </div>

      {/* ── Bulk result banner ── */}
      {(bulkResult.created > 0 || bulkResult.failed > 0) && (
        <div className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-900">
          {`${t("admin_reports_bulk_result_prefix")} ${bulkResult.created} ${t("admin_reports_bulk_result_created")} · ${bulkResult.failed} ${t("admin_reports_bulk_result_failed")}`}
        </div>
      )}

      {/* ── Filters ── */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <FaMagnifyingGlass className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-xs" />
          <input
            type="search"
            placeholder="ค้นหาบริษัท..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white pl-8 pr-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-400 transition"
          />
        </div>
        <div className="flex gap-2">
          {(["all", "published", "draft"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${
                statusFilter === s
                  ? "bg-slate-900 text-white border-slate-900"
                  : "bg-white text-slate-600 border-slate-200 hover:border-slate-300 hover:bg-slate-50"
              }`}
            >
              {s === "all" ? "ทั้งหมด" : s === "published" ? t("admin_report_status_published") : t("admin_report_status_draft")}
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
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">

        {filtered.length === 0 ? (
          <div className="px-5 py-16 text-center">
            <div className="flex flex-col items-center gap-2 text-slate-500">
              <FaFileLines className="text-3xl opacity-30" />
              <p className="text-sm">{search || statusFilter !== "all" ? "ไม่พบ Report ที่ค้นหา" : t("admin_reports_empty")}</p>
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
                    <th className="text-left text-xs font-medium text-slate-500 px-5 py-3">{t("admin_reports_col_month")}</th>
                    <th className="text-left text-xs font-medium text-slate-500 px-5 py-3">{t("admin_reports_col_tasks_short")}</th>
                    <th className="text-left text-xs font-medium text-slate-500 px-5 py-3">{t("admin_reports_col_status")}</th>
                    <th className="text-left text-xs font-medium text-slate-500 px-5 py-3">{t("admin_reports_col_email")}</th>
                    <th className="px-5 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map((report) => {
                    const notified = report.client_notified_at != null;
                    const isPublished = report.status === "published";
                    const st = statusStyle[report.status];
                    const initials = getInitials(report.company_name);
                    const avatarCls = avatarColor(report.company_name);
                    return (
                      <tr key={report.id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-3">
                            <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[10px] font-bold ${avatarCls}`}>{initials}</span>
                            <span className="font-medium text-slate-900">{report.company_name}</span>
                          </div>
                        </td>
                        <td className="px-5 py-3.5 text-slate-600 text-sm">{formatReportPeriod(report.month, report.year)}</td>
                        <td className="px-5 py-3.5 text-slate-500 text-sm">{report.total_tasks} {t("items")}</td>
                        <td className="px-5 py-3.5">
                          <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${st.badge}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />
                            {isPublished ? t("admin_report_status_published") : t("admin_report_status_draft")}
                          </span>
                        </td>
                        <td className="px-5 py-3.5">
                          <EmailStatusCell report={report} notified={notified} isPublished={isPublished} t={t} lang={lang} formatRelativeTime={formatRelativeTime} formatDate={formatDate} />
                        </td>
                        <td className="px-5 py-3.5">
                          <ActionButtons report={report} notified={notified} isPublished={isPublished} isCoAdmin={isCoAdmin} t={t} onDialog={setEmailDialog} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Cards — below lg */}
            <div className="lg:hidden divide-y divide-slate-100">
              {filtered.map((report) => {
                const notified = report.client_notified_at != null;
                const isPublished = report.status === "published";
                const st = statusStyle[report.status];
                const initials = getInitials(report.company_name);
                const avatarCls = avatarColor(report.company_name);
                return (
                  <div key={report.id} className="p-4 space-y-3">
                    {/* Top row: avatar + name + badges */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[10px] font-bold ${avatarCls}`}>{initials}</span>
                        <div className="min-w-0">
                          <p className="font-medium text-slate-900 text-sm truncate">{report.company_name}</p>
                          <p className="text-xs text-slate-500">{formatReportPeriod(report.month, report.year)} · {report.total_tasks} {t("items")}</p>
                        </div>
                      </div>
                      <span className={`inline-flex shrink-0 items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${st.badge}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />
                        {isPublished ? t("admin_report_status_published") : t("admin_report_status_draft")}
                      </span>
                    </div>

                    {/* Email status */}
                    <EmailStatusCell report={report} notified={notified} isPublished={isPublished} t={t} lang={lang} formatRelativeTime={formatRelativeTime} formatDate={formatDate} />

                    {/* Actions */}
                    <div className="flex flex-wrap gap-1.5">
                      <ActionButtons report={report} notified={notified} isPublished={isPublished} isCoAdmin={isCoAdmin} t={t} onDialog={setEmailDialog} />
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {filtered.length > 0 && (
          <div className="border-t border-slate-100 px-5 py-2.5 bg-slate-50/40">
            <p className="text-xs text-slate-500">แสดง {filtered.length} จาก {reports.length} รายการ</p>
          </div>
        )}
      </div>
    </div>
  );
}
