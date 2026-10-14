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
        <h1 className="text-[28px] md:text-[32px] font-bold leading-tight tracking-[-0.02em] text-ink">{t("docs_title")}</h1>
        <p className="mt-1 text-sm text-muted-ink">{t("docs_subtitle")}</p>
      </div>

      {/* Monthly Reports */}
      <div className="bg-white rounded-[20px] border border-line overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-line-soft">
          <div className="flex items-center gap-2">
            <FaFileLines className="text-faint-ink text-sm" aria-hidden="true" />
            <h2 className="text-[16px] font-semibold text-ink">{t("docs_monthly_reports")}</h2>
            <span className="text-xs text-muted-ink font-normal">({reports.length})</span>
          </div>
          {reports.length > 0 && (
            <a href="/reports" className="inline-flex items-center gap-1 text-xs font-medium text-muted-ink hover:text-ink transition-colors">
              {t("view_all")} <FaArrowRight className="text-[9px]" />
            </a>
          )}
        </div>

        {reports.length === 0 ? (
          <div className="px-5 py-16 text-center">
            <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-paper text-faint-ink"><FaFileLines className="text-base" aria-hidden="true" /></span>
            <p className="text-sm text-ink font-medium">{t("docs_no_docs_title")}</p>
            <p className="text-muted-ink text-sm mt-1">{t("docs_no_docs_subtitle")}</p>
          </div>
        ) : (
          <div className="divide-y divide-line-soft">
            {reports.map((report, idx) => (
              <div
                key={report.id}
                className="flex items-center gap-4 px-5 py-3.5 hover:bg-paper transition-colors group"
              >
                {/* Icon */}
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-paper">
                  <FaFileLines className="text-muted-ink text-sm" aria-hidden="true" />
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-ink-soft truncate">
                    {report.title || `${t("docs_monthly_reports")} ${getMonthName(report.month, lang)} ${yearDisplay(report.year)}`}
                  </p>
                  <p className="text-xs text-muted-ink mt-0.5">
                    {getMonthName(report.month, lang)} {yearDisplay(report.year)}
                    {report.total_tasks > 0 && (
                      <span className="ml-2 text-faint-ink">· {report.total_tasks} {t("docs_tasks_suffix")}</span>
                    )}
                    {idx === 0 && (
                      <span className="ml-2 inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold bg-brand-yellow text-ink">ล่าสุด</span>
                    )}
                  </p>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 shrink-0">
                  <a
                    href={`/reports/${report.id}`}
                    className="inline-flex h-10 items-center gap-1.5 rounded-full border border-line bg-white px-4 text-[13px] font-semibold text-ink hover:bg-paper transition-colors"
                  >
                    {t("docs_view_report")}
                  </a>
                  <button
                    type="button"
                    onClick={() => {
                      const w = window.open(`/reports/${report.id}`, "_blank");
                      if (w) setTimeout(() => w.print(), 800);
                    }}
                    className="inline-flex h-10 items-center gap-1.5 rounded-full border border-line bg-white px-4 text-[13px] font-semibold text-ink hover:bg-paper transition-colors"
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
      <div className="rounded-[20px] border border-line bg-white px-5 py-4">
        <p className="text-xs font-semibold text-ink-soft mb-1">{t("docs_about_title")}</p>
        <p className="text-sm text-muted-ink leading-relaxed">
          {t("docs_about_body")}{" "}
          <a href="/tickets/new" className="text-ink underline-offset-4 hover:underline font-medium">
            {t("docs_contact_link")}
          </a>
        </p>
      </div>
    </div>
  );
}
