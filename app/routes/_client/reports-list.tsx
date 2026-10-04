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
        <h1 className="text-[28px] md:text-[32px] font-bold leading-tight tracking-[-0.02em] text-ink">{t("reports_title")}</h1>
        <p className="mt-1 text-sm text-muted-ink">{t("reports_subtitle")}</p>
      </div>

      {reports.length === 0 ? (
        <div className="bg-white rounded-[20px] border border-line px-6 py-12 md:p-16 text-center">
          <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-paper text-faint-ink"><FaFileLines className="text-base" aria-hidden="true" /></span>
          <p className="text-sm text-ink font-medium">ยังไม่มีรายงาน</p>
          <p className="text-muted-ink text-sm mt-1">ทีมจะเผยแพร่รายงานหลังสิ้นสุดแต่ละเดือน</p>
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
      className="group block bg-white rounded-[20px] border border-line hover:border-ink/30 transition-all overflow-hidden"
    >
      {/* Header */}
      <div className="px-5 pt-5 pb-4 flex items-start justify-between gap-2">
        <div>
          <p className="text-xs text-muted-ink mb-0.5">{yearDisplay(report.year)}</p>
          <h3 className="font-display text-[22px] font-bold tracking-[-0.02em] text-ink leading-tight">
            {getThaiMonth(report.month)}
          </h3>
          <p className="text-xs text-muted-ink mt-1 line-clamp-2">{report.title}</p>
        </div>
        {isLatest && (
          <span className="shrink-0 inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold bg-brand-yellow text-ink">
            ล่าสุด
          </span>
        )}
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 divide-x divide-line-soft border-t border-line-soft">
        <div className="px-4 py-3 text-center">
          <p className="font-display text-[18px] font-bold tabular-nums text-ink">{report.total_tasks}</p>
          <p className="text-[10px] text-muted-ink mt-0.5">งาน</p>
        </div>
        <div className="px-4 py-3 text-center">
          <p className="font-display text-[18px] font-bold tabular-nums text-ink">
            {report.uptime_percent != null ? `${report.uptime_percent.toFixed(1)}%` : "—"}
          </p>
          <p className="text-[10px] text-muted-ink mt-0.5">อัพไทม์</p>
        </div>
        <div className="px-4 py-3 text-center">
          <p className="font-display text-[18px] font-bold tabular-nums text-ink">
            {report.speed_score != null ? report.speed_score : "—"}
          </p>
          <p className="text-[10px] text-muted-ink mt-0.5">สปีด</p>
        </div>
      </div>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-line-soft bg-paper flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-ink-soft">
          <span className="h-1.5 w-1.5 rounded-full bg-ink" />
          เผยแพร่แล้ว
        </span>
        <FaArrowRight className="text-[10px] text-faint-ink group-hover:text-muted-ink group-hover:translate-x-0.5 transition-all" />
      </div>
    </a>
  );
}
