import { useState } from "react";
import type { Route } from "./+types/reports";
import { requireAdmin } from "~/lib/auth.server";
import ReportCustomerEmailDialog, {
  type ReportRowForEmail,
} from "~/components/reports/ReportCustomerEmailDialog";
import { createDB } from "~/lib/db.server";
import { formatDate, formatRelativeTime, getMonthName } from "~/lib/utils";
import { useT } from "~/lib/i18n";
import { FaEye, FaFileCirclePlus, FaPaperPlane, FaRotateRight, FaPenToSquare, FaMagnifyingGlass } from "react-icons/fa6";
export function meta() {
  return [{ title: "จัดการ Report — Admin" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  await requireAdmin(request, context.cloudflare.env.DB, context.cloudflare.env.SESSIONPORTAL);
  const db = createDB(context.cloudflare.env.DB);
  const clients = await db.listClients();

  const allReports: ReportRowForEmail[] = [];
  for (const client of clients) {
    const user = await db.getUserById(client.user_id);
    const reports = await db.listReportsByClient(client.id);
    for (const r of reports.slice(0, 3)) {
      allReports.push({
        ...r,
        company_name: client.company_name,
        client_email: user?.email ?? "",
        client_contact_name: user?.name ?? "",
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
    bulkResult: {
      created: Number.isNaN(bulkCreated) ? 0 : bulkCreated,
      failed: Number.isNaN(bulkFailed) ? 0 : bulkFailed,
    },
  };
}

const statusStyle = {
  draft: "bg-slate-100 text-slate-500",
  published: "bg-emerald-50 text-emerald-600",
};

export default function AdminReportsPage({ loaderData }: Route.ComponentProps) {
  const { reports, bulkResult } = loaderData as {
    reports: ReportRowForEmail[];
    bulkResult: { created: number; failed: number };
  };
  const { t, lang } = useT();

  const [emailDialog, setEmailDialog] = useState<{
    report: ReportRowForEmail;
    mode: "send" | "view";
  } | null>(null);

  const formatReportPeriod = (month: number, year: number) => {
    const m = getMonthName(month, lang);
    if (lang === "en") return `${m} ${year}`;
    return `${m} ${year + 543}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">
            {t("admin_reports_page_title")}
          </h1>
          <p className="text-slate-500 text-sm mt-1">
            {t("admin_reports_page_subtitle")}
          </p>
        </div>
        <a
          href="/admin/reports/new"
          className="flex items-center gap-2 bg-[#F0D800] text-slate-900 rounded-lg px-4 py-2 text-sm font-medium hover:bg-yellow-400 transition-colors"
        >
          <FaFileCirclePlus aria-hidden="true" />
          {t("admin_reports_new_btn")}
        </a>
      </div>

      <ReportCustomerEmailDialog
        report={emailDialog?.report ?? null}
        open={emailDialog != null}
        onOpenChange={(open) => {
          if (!open) setEmailDialog(null);
        }}
        mode={emailDialog?.mode ?? "send"}
      />

      {(bulkResult.created > 0 || bulkResult.failed > 0) && (
        <div className="rounded-lg border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-900">
          {`${t("admin_reports_bulk_result_prefix")} ${bulkResult.created} ${t("admin_reports_bulk_result_created")} · ${bulkResult.failed} ${t("admin_reports_bulk_result_failed")}`}
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[850px]">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="text-left text-xs font-medium text-slate-500 px-5 py-3">
                  {t("admin_col_client")}
                </th>
                <th className="text-left text-xs font-medium text-slate-500 px-5 py-3">
                  {t("admin_reports_col_month")}
                </th>
                <th className="text-left text-xs font-medium text-slate-500 px-5 py-3">
                  {t("admin_reports_col_tasks_short")}
                </th>
                <th className="text-left text-xs font-medium text-slate-500 px-5 py-3">
                  {t("admin_reports_col_status")}
                </th>
                <th className="text-left text-xs font-medium text-slate-500 px-5 py-3">
                  {t("admin_reports_col_email")}
                </th>
                <th className="text-right text-xs font-medium text-slate-500 px-5 py-3">
                  {t("admin_reports_col_actions")}
                </th>
              </tr>
            </thead>
            <tbody>
              {reports.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-5 py-12 text-center text-slate-400"
                  >
                    {t("admin_reports_empty")}
                  </td>
                </tr>
              ) : (
                reports.map((report) => {
                  const notified = report.client_notified_at != null;
                  const isPublished = report.status === "published";

                  return (
                    <tr
                      key={report.id}
                      className="border-b border-slate-100 last:border-0 hover:bg-slate-50/80 transition-colors"
                    >
                      <td className="px-5 py-4 font-medium text-slate-900">
                        {report.company_name}
                      </td>
                      <td className="px-5 py-4 text-slate-600">
                        {formatReportPeriod(report.month, report.year)}
                      </td>
                      <td className="px-5 py-4 text-slate-500">
                        {report.total_tasks} {t("items")}
                      </td>
                      <td className="px-5 py-4">
                        <span
                          className={`text-xs font-medium px-2 py-1 rounded-full ${statusStyle[report.status]}`}
                        >
                          {report.status === "published"
                            ? t("admin_report_status_published")
                            : t("admin_report_status_draft")}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        {!isPublished ? (
                          <span className="text-xs text-slate-400">
                            {t("admin_report_email_publish_first")}
                          </span>
                        ) : notified ? (
                          <div className="flex flex-col gap-1.5">
                            <span className="inline-flex w-fit items-center gap-1 rounded-full bg-violet-50 text-violet-700 text-[11px] font-semibold px-2 py-0.5">
                              <span className="w-1 h-1 rounded-full bg-violet-500" />
                              {t("admin_report_email_badge_sent")}
                            </span>
                            <span className="text-[11px] text-slate-500">
                              {lang === "en"
                                ? formatRelativeTime(report.client_notified_at!, "en")
                                : formatRelativeTime(report.client_notified_at!, "th")}
                              <span className="text-slate-400">
                                {" · "}
                                {formatDate(report.client_notified_at!, lang)}
                              </span>
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-amber-700 font-medium bg-amber-50 px-2 py-1 rounded-md">
                            {t("admin_report_email_not_sent")}
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-4 text-right">
                        <div className="flex flex-col sm:flex-row items-stretch sm:items-start justify-end gap-2">
                          {isPublished && (
                            <>
                              {!notified ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setEmailDialog({ report, mode: "send" })
                                  }
                                  className="inline-flex items-center justify-center gap-1 rounded-lg bg-violet-600 text-white text-xs font-medium px-3 py-2 hover:bg-violet-700 transition-colors shadow-sm"
                                >
                                  <FaPaperPlane aria-hidden="true" />
                                  {t("admin_report_email_btn_send")}
                                </button>
                              ) : (
                                <div className="flex flex-col gap-1.5 items-stretch sm:items-start">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setEmailDialog({ report, mode: "view" })
                                    }
                                    className="inline-flex items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white text-slate-700 text-xs font-medium px-3 py-2 hover:bg-slate-50 transition-colors"
                                  >
                                    <FaEye aria-hidden="true" />
                                    {t("admin_report_email_btn_view")}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setEmailDialog({ report, mode: "send" })
                                    }
                                    className="inline-flex items-center gap-1 text-[11px] font-medium text-violet-600 hover:text-violet-800 underline-offset-2 hover:underline"
                                  >
                                    <FaRotateRight aria-hidden="true" />
                                    {t("admin_report_email_btn_resend")}
                                  </button>
                                </div>
                              )}
                            </>
                          )}
                          <a
                            href={`/admin/reports/${report.id}`}
                            className="inline-flex items-center justify-center gap-1 rounded-lg border border-transparent text-xs text-slate-500 hover:text-slate-900 transition-colors p-2"
                          >
                            <FaPenToSquare aria-hidden="true" />
                            {t("admin_reports_edit")}
                          </a>
                          <a
                            href={`/reports/${report.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white text-xs text-slate-600 hover:bg-slate-50 transition-colors px-3 py-2"
                          >
                            <FaMagnifyingGlass aria-hidden="true" />
                            {t("admin_reports_preview")}
                          </a>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
