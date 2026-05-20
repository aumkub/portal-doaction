import { ArrowRight } from "lucide-react";
import { getThaiMonth } from "~/lib/utils";
import type { MonthlyReport } from "~/types";

const statusConfig = {
  published: {
    label: "เผยแพร่แล้ว",
    className: "bg-teal-light text-moss-dark",
  },
  draft: {
    label: "แบบร่าง",
    className: "bg-surface text-muted-foreground",
  },
};

export default function ReportCard({ report }: { report: MonthlyReport }) {
  const st = statusConfig[report.status];

  return (
    <a
      href={`/reports/${report.id}`}
      className="group block bg-canvas rounded-xl border border-hairline p-5 hover:border-hairline-strong hover:shadow-sm transition-all"
    >
      <div className="flex items-start justify-between mb-4">
        <div>
          <p className="text-xs text-stone mb-0.5">{report.year + 543}</p>
          <h3 className="font-semibold text-ink text-base">{getThaiMonth(report.month)}</h3>
        </div>
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${st.className}`}>
          {st.label}
        </span>
      </div>

      <div className={`grid gap-2 mb-4 ${report.speed_score != null ? "grid-cols-3" : "grid-cols-2"}`}>
        <div className="text-center p-2 bg-surface rounded-lg">
          <p className="text-lg font-semibold text-ink">{report.total_tasks}</p>
          <p className="text-[10px] text-steel">งาน</p>
        </div>
        <div className="text-center p-2 bg-surface rounded-lg">
          <p className="text-lg font-semibold text-ink">
            {report.uptime_percent != null ? `${report.uptime_percent.toFixed(1)}%` : "—"}
          </p>
          <p className="text-[10px] text-steel">อัพไทม์</p>
        </div>
        {report.speed_score != null ? (
          <div className="text-center p-2 bg-surface rounded-lg">
            <p className="text-lg font-semibold text-ink">{report.speed_score}</p>
            <p className="text-[10px] text-steel">สปีด</p>
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-between text-xs text-steel">
        <span>{report.title}</span>
        <ArrowRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-60 transition-opacity" />
      </div>
    </a>
  );
}
