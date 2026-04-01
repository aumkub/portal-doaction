import type { Route } from "./+types/reports";
import { requireUser } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";
import { getMonthName } from "~/lib/utils";
import { useT } from "~/lib/i18n";
import type { MonthlyReport, ReportTask } from "~/types";
import { FaFileLines, FaCircleCheck } from "react-icons/fa6";

export function meta() {
  return [{ title: "Monthly Reports — do action portal" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const user = await requireUser(request, context.cloudflare.env.DB, context.cloudflare.env.SESSIONPORTAL);
  const db = createDB(context.cloudflare.env.DB);
  const client = await db.getClientByUserId(user.id);
  if (!client) return { reports: [], tasks: [], selectedReport: null };

  const reports = await db.listReportsByClient(client.id);
  const publishedReports = reports.filter((r) => r.status === "published");

  const url = new URL(request.url);
  const reportId = url.searchParams.get("report") ?? publishedReports[0]?.id;
  const selectedReport = publishedReports.find((r) => r.id === reportId) ?? null;
  const tasks = selectedReport
    ? await db.listTasksByReport(selectedReport.id)
    : [];

  return { reports: publishedReports, selectedReport, tasks };
}

export default function ReportsPage({ loaderData }: Route.ComponentProps) {
  const { reports, selectedReport, tasks } = loaderData as {
    reports: MonthlyReport[];
    selectedReport: MonthlyReport | null;
    tasks: ReportTask[];
  };
  const { t, lang } = useT();

  const categoryLabels: Record<string, string> = {
    maintenance: t("cat_maintenance"),
    development: t("cat_development"),
    security: t("cat_security"),
    seo: t("cat_seo"),
    performance: t("cat_performance"),
    other: t("cat_other"),
  };

  const yearDisplay = (year: number) =>
    lang === "th" ? year + 543 : year;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">
            {t("reports_title")}
          </h1>
          <p className="text-slate-500 text-sm mt-1">{t("reports_subtitle")}</p>
        </div>

        {reports.length > 0 && (
          <form>
            <select
              name="report"
              defaultValue={selectedReport?.id ?? ""}
              onChange={(e) => {
                const url = new URL(window.location.href);
                url.searchParams.set("report", e.target.value);
                window.location.href = url.toString();
              }}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-900"
            >
              {reports.map((r) => (
                <option key={r.id} value={r.id}>
                  {getMonthName(r.month, lang)} {yearDisplay(r.year)}
                </option>
              ))}
            </select>
          </form>
        )}
      </div>

      {!selectedReport ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <p className="text-slate-400">{t("reports_no_reports")}</p>
        </div>
      ) : (
        <>
          {/* Summary */}
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-1">
              {selectedReport.title}
            </h2>
            {selectedReport.summary && (
              <p className="text-slate-500 text-sm mb-4">
                {selectedReport.summary}
              </p>
            )}
            <div className="grid grid-cols-2 gap-4 mt-4">
              <div className="text-center p-3 bg-slate-50 rounded-lg">
                <p className="text-xs text-slate-500">{t("reports_total_tasks")}</p>
                <p className="text-2xl font-semibold text-slate-900">
                  {selectedReport.total_tasks}
                </p>
              </div>
              <div className="text-center p-3 bg-slate-50 rounded-lg">
                <p className="text-xs text-slate-500">{t("reports_uptime")}</p>
                <p className="text-2xl font-semibold text-slate-900">
                  {selectedReport.uptime_percent != null
                    ? `${selectedReport.uptime_percent.toFixed(2)}%`
                    : "—"}
                </p>
              </div>
            </div>
          </div>

          {/* Task list */}
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <h2 className="text-sm font-semibold text-slate-900 mb-4">
              <span className="inline-flex items-center gap-2">
                <FaFileLines aria-hidden="true" />
                {t("reports_tasks_list")} ({tasks.length} {t("items")})
              </span>
            </h2>
            {tasks.length === 0 ? (
              <p className="text-slate-400 text-sm">{t("reports_no_tasks")}</p>
            ) : (
              <ul className="space-y-3">
                {tasks.map((task) => (
                  <li
                    key={task.id}
                    className="flex items-start gap-3 py-3 border-b border-slate-100 last:border-0"
                  >
                    <FaCircleCheck className="text-emerald-500 mt-0.5" aria-hidden="true" />
                    <div className="flex-1">
                      <p className="text-sm text-slate-700 font-medium">
                        {task.title}
                      </p>
                      {task.description && (
                        <p className="text-xs text-slate-400 mt-0.5">
                          {task.description}
                        </p>
                      )}
                    </div>
                    <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">
                      {categoryLabels[task.category] ?? task.category}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Export */}
          <div className="flex justify-end">
            <button
              type="button"
              className="flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
            >
              {t("btn_export_pdf")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
