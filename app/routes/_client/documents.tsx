import { Printer } from "lucide-react";
import type { Route } from "./+types/documents";
import { requireUser } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";
import { getMonthName } from "~/lib/utils";
import { useT } from "~/lib/i18n";
import PageHeader from "~/components/layout/PageHeader";
import type { MonthlyReport } from "~/types";

export function meta() {
  return [{ title: "Documents — DoAction Portal" }];
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
  const { reports, client } = loaderData as {
    reports: MonthlyReport[];
    client: any;
  };
  const { t, lang } = useT();

  const yearDisplay = (year: number) => (lang === "th" ? year + 543 : year);

  return (
    <div className="space-y-6 max-w-4xl">
      <PageHeader
        title={t("docs_title")}
        subtitle={t("docs_subtitle")}
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: t("docs_title") },
        ]}
      />

      {/* Monthly Reports section */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700">
            {t("docs_monthly_reports")} ({reports.length})
          </h2>
          <a
            href="/reports"
            className="text-xs text-violet-600 hover:text-violet-700 font-medium"
          >
            {t("view_all")}
          </a>
        </div>

        {reports.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 p-16 text-center">
            <p className="text-4xl mb-3">📄</p>
            <p className="text-slate-600 font-medium">{t("docs_no_docs_title")}</p>
            <p className="text-slate-400 text-sm mt-1">{t("docs_no_docs_subtitle")}</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
            {reports.map((report) => (
              <div
                key={report.id}
                className="flex items-center gap-4 px-5 py-4 hover:bg-slate-50 transition-colors group"
              >
                <div className="w-10 h-10 rounded-lg bg-violet-50 flex items-center justify-center shrink-0">
                  <span className="text-base">📋</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate">
                    {report.title ||
                      `${t("docs_monthly_reports")} ${getMonthName(report.month, lang)} ${yearDisplay(report.year)}`}
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {getMonthName(report.month, lang)} {yearDisplay(report.year)}
                    {report.total_tasks > 0 && ` · ${report.total_tasks} ${t("docs_tasks_suffix")}`}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <a
                    href={`/reports/${report.id}`}
                    className="text-xs text-slate-500 hover:text-violet-600 transition-colors font-medium"
                  >
                    {t("docs_view_report")}
                  </a>
                  <a
                    href={`/reports/${report.id}?print=1`}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => {
                      e.preventDefault();
                      const w = window.open(`/reports/${report.id}`, "_blank");
                      if (w) setTimeout(() => w.print(), 800);
                    }}
                    className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-700 transition-colors"
                    title="Export PDF"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    PDF
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Info box */}
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <p className="text-xs font-semibold text-slate-600 mb-1">{t("docs_about_title")}</p>
        <p className="text-sm text-slate-500 leading-relaxed">
          {t("docs_about_body")}{" "}
          <a href="/tickets/new" className="text-violet-600 hover:underline">
            {t("docs_contact_link")}
          </a>
        </p>
      </div>
    </div>
  );
}
