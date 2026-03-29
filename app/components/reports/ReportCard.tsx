import { ArrowRight } from "lucide-react";
import { getThaiMonth } from "~/lib/utils";
import type { MonthlyReport } from "~/types";

interface ReportCardProps {
  report: MonthlyReport;
}

const statusConfig = {
  published: {
    label: "เผยแพร่แล้ว",
    className: "bg-emerald-50 text-emerald-600",
  },
  draft: {
    label: "แบบร่าง",
    className: "bg-slate-100 text-slate-500",
  },
};

export default function ReportCard({ report }: ReportCardProps) {
  const st = statusConfig[report.status];

  return (
    <a
      href={`/reports/${report.id}`}
      className="group block bg-white rounded-xl border border-slate-200 p-5 hover:border-slate-300 hover:shadow-md transition-all"
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <p className="text-xs text-slate-400 mb-0.5">
            {report.year + 543}
          </p>
          <h3 className="font-semibold text-slate-900 text-base">
            {getThaiMonth(report.month)}
          </h3>
        </div>
        <span
          className={`text-xs font-medium px-2 py-0.5 rounded-full ${st.className}`}
        >
          {st.label}
        </span>
      </div>

      {/* Stats row */}
      <div
        className={`grid gap-2 mb-4 ${
          report.speed_score != null ? "grid-cols-3" : "grid-cols-2"
        }`}
      >
        <div className="text-center p-2 bg-slate-50 rounded-lg">
          <p className="text-lg font-semibold text-slate-900">
            {report.total_tasks}
          </p>
          <p className="text-[10px] text-slate-400">งาน</p>
        </div>
        <div className="text-center p-2 bg-slate-50 rounded-lg">
          <p className="text-lg font-semibold text-slate-900">
            {report.uptime_percent != null
              ? `${report.uptime_percent.toFixed(1)}%`
              : "—"}
          </p>
          <p className="text-[10px] text-slate-400">อัพไทม์</p>
        </div>
        {report.speed_score != null ? (
          <div className="text-center p-2 bg-slate-50 rounded-lg">
            <p className="text-lg font-semibold text-slate-900">
              {report.speed_score}
            </p>
            <p className="text-[10px] text-slate-400">สปีด</p>
          </div>
        ) : null}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between text-xs text-slate-400">
        <span>{report.title}</span>
        <ArrowRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-60 transition-opacity" />
      </div>
    </a>
  );
}
