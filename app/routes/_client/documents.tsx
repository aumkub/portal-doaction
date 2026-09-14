import { Printer } from "lucide-react";
import type { Route } from "./+types/documents";
import { requireUser } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";
import { getMonthName } from "~/lib/utils";
import { useT } from "~/lib/i18n";
import type { MonthlyReport } from "~/types";
import { FaFileLines, FaArrowRight, FaArrowUpRightFromSquare } from "react-icons/fa6";

export function meta() {
  return [{ title: "Documents — do action portal" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const user = await requireUser(request, env.DB, env.SESSIONPORTAL);
  const db = createDB(env.DB);
  const client = await db.getClientByUserId(user.id);
  if (!client) return { reports: [], client: null };
  const allReports = await db.listReportsByClient(client.id);
  const reports = allReports.filter((r) => r.status === "published");
  return { reports, client };
}

export default function DocumentsPage({ loaderData }: Route.ComponentProps) {
  const { reports } = loaderData as { reports: MonthlyReport[]; client: any };
  const { t, lang } = useT();
  const yearDisplay = (year: number) => (lang === "th" ? year + 543 : year);

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">{t("docs_title")}</h1>
        <p className="mt-1 text-sm text-slate-500">{t("docs_subtitle")}</p>
      </div>

      {/* Monthly Reports */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <FaFileLines className="text-violet-500 text-sm" aria-hidden="true" />
            <h2 className="text-sm font-semibold text-slate-900">{t("docs_monthly_reports")}</h2>
            <span className="text-xs text-slate-500 font-normal">({reports.length})</span>
          </div>
          {reports.length > 0 && (
            <a href="/reports" className="inline-flex items-center gap-1 text-xs font-medium text-violet-600 hover:text-violet-700 transition-colors">
              {t("view_all")} <FaArrowRight className="text-[9px]" />
            </a>
          )}
        </div>

        {reports.length === 0 ? (
          <div className="px-5 py-16 text-center">
            <FaFileLines className="mx-auto mb-3 text-3xl text-slate-300" aria-hidden="true" />
            <p className="text-slate-700 font-medium">{t("docs_no_docs_title")}</p>
            <p className="text-slate-500 text-sm mt-1">{t("docs_no_docs_subtitle")}</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {reports.map((report, idx) => (
              <div
                key={report.id}
                className="flex items-center gap-4 px-5 py-4 hover:bg-slate-50 transition-colors group"
              >
                {/* Icon */}
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-violet-50">
                  <FaFileLines className="text-violet-600 text-sm" aria-hidden="true" />
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate">
                    {report.title || `${t("docs_monthly_reports")} ${getMonthName(report.month, lang)} ${yearDisplay(report.year)}`}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {getMonthName(report.month, lang)} {yearDisplay(report.year)}
                    {report.total_tasks > 0 && (
                      <span className="ml-2 text-slate-400">· {report.total_tasks} {t("docs_tasks_suffix")}</span>
                    )}
                    {idx === 0 && (
                      <span className="ml-2 text-[10px] font-semibold text-violet-600 bg-violet-50 px-1.5 py-0.5 rounded-full">ล่าสุด</span>
                    )}
                  </p>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 shrink-0">
                  <a
                    href={`/reports/${report.id}`}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:border-slate-300 transition-colors"
                  >
                    {t("docs_view_report")}
                  </a>
                  <button
                    type="button"
                    onClick={() => {
                      const w = window.open(`/reports/${report.id}`, "_blank");
                      if (w) setTimeout(() => w.print(), 800);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:border-slate-300 transition-colors"
                    title="Export PDF"
                  >
                    <Printer className="w-3 h-3" />
                    PDF
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Info card */}
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-5 py-4">
        <p className="text-xs font-semibold text-slate-700 mb-1">{t("docs_about_title")}</p>
        <p className="text-sm text-slate-500 leading-relaxed">
          {t("docs_about_body")}{" "}
          <a href="/tickets/new" className="text-violet-600 hover:underline font-medium">
            {t("docs_contact_link")}
          </a>
        </p>
      </div>
    </div>
  );
}
