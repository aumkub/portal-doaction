import { ArrowRight } from "lucide-react";
import { getThaiMonth } from "~/lib/utils";
import type { MonthlyReport } from "~/types";

const statusConfig = {
  published: {
    label: "เผยแพร่แล้ว",
    className: "bg-emerald-50 text-emerald-700",
  },
  draft: {
    label: "แบบร่าง",
    className: "bg-[#FFF6C2] text-[#6B5B00]",
  },
};

export default function ReportCard({ report }: { report: MonthlyReport }) {
  const st = statusConfig[report.status];

  return (
    <a
      href={`/reports/${report.id}`}
      className="group block bg-white rounded-[20px] border border-line p-5 hover:border-ink/30 transition-colors"
    >
      <div className="flex items-start justify-between mb-4">
        <div>
          <p className="text-xs text-faint-ink mb-0.5">{report.year + 543}</p>
          <h3 className="font-semibold text-ink text-base">{getThaiMonth(report.month)}</h3>
        </div>
        <span className={`text-xs font-medium font-semibold px-2.5 py-0.5 rounded-full ${st.className}`}>
          {st.label}
        </span>
      </div>

      <div className={`grid gap-2 mb-4 ${report.speed_score != null ? "grid-cols-3" : "grid-cols-2"}`}>
        <div className="text-center p-2 bg-paper rounded-[12px]">
          <p className="font-display text-lg font-bold tabular-nums text-ink">{report.total_tasks}</p>
          <p className="text-[10px] text-muted-ink">งาน</p>
        </div>
        <div className="text-center p-2 bg-paper rounded-[12px]">
          <p className="font-display text-lg font-bold tabular-nums text-ink">
            {report.uptime_percent != null ? `${report.uptime_percent.toFixed(1)}%` : "—"}
          </p>
          <p className="text-[10px] text-muted-ink">อัพไทม์</p>
        </div>
        {report.speed_score != null ? (
          <div className="text-center p-2 bg-paper rounded-[12px]">
            <p className="font-display text-lg font-bold tabular-nums text-ink">{report.speed_score}</p>
            <p className="text-[10px] text-muted-ink">สปีด</p>
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-between text-xs text-muted-ink">
        <span>{report.title}</span>
        <ArrowRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-60 transition-opacity" />
      </div>
    </a>
  );
}
