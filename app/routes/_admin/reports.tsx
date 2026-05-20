import { useState } from "react";
import { useRevalidator } from "react-router";
import type { Route } from "./+types/reports";
import Pagination from "~/components/ui/Pagination";
import { requireCoAdminOrAdmin } from "~/lib/auth.server";
import ReportCustomerEmailDialog, {
  type ReportRowForEmail,
} from "~/components/reports/ReportCustomerEmailDialog";
import { createDB } from "~/lib/db.server";
import { formatDate, formatRelativeTime, getMonthName } from "~/lib/utils";
import { useT } from "~/lib/i18n";
import { FaEye, FaFileCirclePlus, FaPaperPlane, FaRotateRight, FaPenToSquare, FaMagnifyingGlass, FaTelegram } from "react-icons/fa6";
export function meta() {
  return [{ title: "จัดการ Report — Admin" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const user = await requireCoAdminOrAdmin(request, env.DB, env.SESSIONPORTAL);
  const db = createDB(env.DB);

  let clients;
  if (user.role === "co-admin") {
    // Co-admins only see their assigned clients
    const assignments = await db.listCoAdminClients(user.id);
    const clientIds = assignments.map((a) => a.client_id);
    clients = (await db.listClients()).filter((c) => clientIds.includes(c.id));
  } else {
    // Admins see all clients
    clients = await db.listClients();
  }

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
  const PAGE_SIZE = 20;
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1"));
  const total = allReports.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const reports = allReports.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return {
    reports,
    clients,
    userRole: user.role,
    page: safePage,
    totalPages,
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
  const { reports, bulkResult, userRole, page, totalPages } = loaderData as {
    reports: ReportRowForEmail[];
    bulkResult: { created: number; failed: number };
    userRole: "admin" | "co-admin";
    page: number;
    totalPages: number;
  };
  const { t, lang } = useT();
  const isCoAdmin = userRole === "co-admin";

  const revalidator = useRevalidator();
  const [emailDialog, setEmailDialog] = useState<{
    report: ReportRowForEmail;
    mode: "send" | "view";
  } | null>(null);
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
        {!isCoAdmin && (
          <a
            href="/admin/reports/new"
            className="flex items-center gap-2 bg-[#F0D800] text-slate-900 rounded-lg px-4 py-2 text-sm font-medium hover:bg-yellow-400 transition-colors"
          >
            <FaFileCirclePlus aria-hidden="true" />
            {t("admin_reports_new_btn")}
          </a>
        )}
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
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="text-left text-xs font-medium text-slate-500 px-3 py-2">
                  {t("admin_col_client")}
                </th>
                <th className="text-left text-xs font-medium text-slate-500 px-3 py-2">
                  {t("admin_reports_col_month")}
                </th>
                <th className="text-left text-xs font-medium text-slate-500 px-3 py-2">
                  {t("admin_reports_col_status")}
                </th>
                <th className="text-left text-xs font-medium text-slate-500 px-3 py-2 w-[250px]">
                  {t("admin_reports_col_email")}
                </th>
                <th className="text-right text-xs font-medium text-slate-500 px-3 py-2 w-[100px]">
                  {t("admin_reports_col_actions")}
                </th>
              </tr>
            </thead>
            <tbody>
              {reports.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-3 py-12 text-center text-slate-400"
                  >
                    {t("admin_reports_empty")}
                  </td>
                </tr>
              ) : (
                reports.map((report) => {
                  const notified = report.client_notified_at != null;
                  const telegramSent = report.telegram_notified_at != null;
                  const isPublished = report.status === "published";

                  return (
                    <tr
                      key={report.id}
                      className="border-b border-slate-100 last:border-0 hover:bg-slate-50/80 transition-colors"
                    >
                      <td className="px-3 py-2.5 font-medium text-slate-900">
                        {report.company_name}
                      </td>
                      <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">
                        {formatReportPeriod(report.month, report.year)}
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusStyle[report.status]}`}
                        >
                          {report.status === "published"
                            ? t("admin_report_status_published")
                            : t("admin_report_status_draft")}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-col gap-1">
                          {/* Email row */}
                          {!isPublished ? (
                            <span className="text-xs text-slate-400">
                              {t("admin_report_email_publish_first")}
                            </span>
                          ) : notified ? (
                            <div className="flex items-center gap-1.5">
                              <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 text-violet-700 text-[11px] font-semibold px-2 py-0.5">
                                <span className="w-1 h-1 rounded-full bg-violet-500" />
                                {t("admin_report_email_badge_sent")}
                              </span>
                              {!isCoAdmin && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => setEmailDialog({ report, mode: "view" })}
                                    className="text-[11px] text-slate-500 hover:text-slate-800 underline-offset-2 hover:underline"
                                  >
                                    {t("admin_report_email_btn_view")}
                                  </button>
                                  <span className="text-slate-300">·</span>
                                  <button
                                    type="button"
                                    onClick={() => setEmailDialog({ report, mode: "send" })}
                                    className="inline-flex items-center gap-0.5 text-[11px] font-medium text-violet-600 hover:text-violet-800 underline-offset-2 hover:underline"
                                  >
                                    <FaRotateRight className="text-[9px]" aria-hidden="true" />
                                    {t("admin_report_email_btn_resend")}
                                  </button>
                                </>
                              )}
                            </div>
                          ) : isPublished && !isCoAdmin ? (
                            <button
                              type="button"
                              onClick={() => setEmailDialog({ report, mode: "send" })}
                              className="inline-flex w-fit items-center gap-1 rounded-md bg-violet-600 text-white text-[11px] font-medium px-2 py-1 hover:bg-violet-700 transition-colors"
                            >
                              <FaPaperPlane className="text-[9px]" aria-hidden="true" />
                              {t("admin_report_email_btn_send")}
                            </button>
                          ) : (
                            <span className="text-xs text-amber-700 font-medium bg-amber-50 px-2 py-0.5 rounded-md">
                              {t("admin_report_email_not_sent")}
                            </span>
                          )}

                          {/* Telegram row — admin only, published only */}
                          {isPublished && !isCoAdmin && (
                            <div className="flex items-center gap-1.5">
                              {telegramSent ? (
                                <>
                                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 text-slate-600 text-[11px] font-semibold px-2 py-0.5">
                                    <FaTelegram className="text-[10px]" aria-hidden="true" />
                                    {t("admin_report_telegram_badge_sent")}
                                  </span>
                                  <button
                                    type="button"
                                    disabled={telegramSending === report.id}
                                    onClick={() => sendTelegram(report.id)}
                                    className="inline-flex items-center gap-0.5 text-[11px] font-medium text-slate-500 hover:text-slate-800 underline-offset-2 hover:underline disabled:opacity-40"
                                  >
                                    <FaRotateRight className="text-[9px]" aria-hidden="true" />
                                    {telegramSending === report.id ? "..." : t("admin_report_telegram_btn_resend")}
                                  </button>
                                </>
                              ) : (
                                <button
                                  type="button"
                                  disabled={telegramSending === report.id}
                                  onClick={() => sendTelegram(report.id)}
                                  className="inline-flex w-fit items-center gap-1 rounded-md border border-slate-200 bg-white text-slate-700 text-[11px] font-medium px-2 py-1 hover:bg-slate-50 transition-colors disabled:opacity-40"
                                >
                                  <FaTelegram className="text-[10px]" aria-hidden="true" />
                                  {telegramSending === report.id ? "..." : t("admin_report_telegram_btn_send")}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <div className="inline-flex items-center justify-end gap-0.5">
                          <a
                            href={`/reports/${report.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={t("admin_reports_preview")}
                            className="inline-flex items-center justify-center rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors p-1.5"
                          >
                            <FaMagnifyingGlass className="text-xs" aria-hidden="true" />
                          </a>
                          {!isCoAdmin && (
                            <a
                              href={`/admin/reports/${report.id}`}
                              title={t("admin_reports_edit")}
                              className="inline-flex items-center justify-center rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors p-1.5"
                            >
                              <FaPenToSquare className="text-xs" aria-hidden="true" />
                            </a>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <Pagination page={page} totalPages={totalPages} />
      </div>
    </div>
  );
}
