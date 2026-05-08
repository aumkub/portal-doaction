import type { Route } from "./+types/reports-list";
import { requireUser } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";
import { getThaiMonth } from "~/lib/utils";
import { useT } from "~/lib/i18n";
import type { MonthlyReport } from "~/types";
import { FaFileLines, FaArrowRight } from "react-icons/fa6";
import { CheckCircle2, Globe, Zap } from "lucide-react";

export function meta() {
  return [{ title: "รายงานประจำเดือน — do action portal" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const user = await requireUser(request, env.DB, env.SESSIONPORTAL);
  const db = createDB(env.DB);
  const client = await db.getClientByUserId(user.id);
  if (!client) return { reports: [] };
  const reports = await db.listReportsByClient(client.id);
  return { reports: reports.filter((r) => r.status === "published") };
}

export default function ReportsListPage({ loaderData }: Route.ComponentProps) {
  const { reports } = loaderData as { reports: MonthlyReport[] };
  const { t, lang } = useT();

  const yearDisplay = (year: number) => (lang === "th" ? year + 543 : year);

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">{t("reports_title")}</h1>
        <p className="mt-1 text-sm text-slate-500">{t("reports_subtitle")}</p>
      </div>

      {reports.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-16 text-center">
          <FaFileLines className="mx-auto mb-3 text-3xl text-slate-400" aria-hidden="true" />
          <p className="text-slate-700 font-medium">ยังไม่มีรายงาน</p>
          <p className="text-slate-500 text-sm mt-1">ทีมจะเผยแพร่รายงานหลังสิ้นสุดแต่ละเดือน</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {reports.map((report, idx) => (
            <ReportCard key={report.id} report={report} yearDisplay={yearDisplay} isLatest={idx === 0} />
          ))}
        </div>
      )}
    </div>
  );
}

function ReportCard({
  report,
  yearDisplay,
  isLatest,
}: {
  report: MonthlyReport;
  yearDisplay: (y: number) => number;
  isLatest: boolean;
}) {
  return (
    <a
      href={`/reports/${report.id}`}
      className="group block bg-white rounded-xl border border-slate-200 hover:border-slate-300 hover:shadow-sm transition-all overflow-hidden"
    >
      {/* Header */}
      <div className="px-5 pt-5 pb-4 flex items-start justify-between gap-2">
        <div>
          <p className="text-xs text-slate-500 mb-0.5">{yearDisplay(report.year)}</p>
          <h3 className="text-lg font-semibold text-slate-900 leading-tight">
            {getThaiMonth(report.month)}
          </h3>
          <p className="text-xs text-slate-500 mt-1 line-clamp-2">{report.title}</p>
        </div>
        {isLatest && (
          <span className="shrink-0 text-[10px] font-semibold bg-violet-100 text-violet-700 px-2 py-0.5 rounded-full">
            ล่าสุด
          </span>
        )}
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 divide-x divide-slate-100 border-t border-slate-100">
        <div className="px-4 py-3 text-center">
          <p className="text-base font-semibold text-slate-900">{report.total_tasks}</p>
          <p className="text-[10px] text-slate-500 mt-0.5">งาน</p>
        </div>
        <div className="px-4 py-3 text-center">
          <p className="text-base font-semibold text-slate-900">
            {report.uptime_percent != null ? `${report.uptime_percent.toFixed(1)}%` : "—"}
          </p>
          <p className="text-[10px] text-slate-500 mt-0.5">อัพไทม์</p>
        </div>
        <div className="px-4 py-3 text-center">
          <p className="text-base font-semibold text-slate-900">
            {report.speed_score != null ? report.speed_score : "—"}
          </p>
          <p className="text-[10px] text-slate-500 mt-0.5">สปีด</p>
        </div>
      </div>

      {/* Footer */}
      <div className="px-5 py-3 bg-slate-50 flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-700">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          เผยแพร่แล้ว
        </span>
        <FaArrowRight className="text-[10px] text-slate-400 group-hover:text-slate-600 group-hover:translate-x-0.5 transition-all" />
      </div>
    </a>
  );
}
