import { Globe, Zap, CheckCircle2 } from "lucide-react";
import type { MonthlyReport } from "~/types";

interface ReportStatsProps {
  report: MonthlyReport;
}

export default function ReportStats({ report }: ReportStatsProps) {
  const items = [
    {
      icon: <CheckCircle2 className="w-5 h-5" />,
      label: "งานทั้งหมด",
      value: String(report.total_tasks),
      suffix: "รายการ",
      color: "emerald" as const,
    },
    {
      icon: <Globe className="w-5 h-5" />,
      label: "อัพไทม์",
      value:
        report.uptime_percent != null
          ? `${report.uptime_percent.toFixed(2)}%`
          : "—",
      color: "blue" as const,
    },
    ...(report.speed_score != null
      ? [
          {
            icon: <Zap className="w-5 h-5" />,
            label: "คะแนนสปีด",
            value: String(report.speed_score),
            suffix: "/ 100" as const,
            color: "amber" as const,
          },
        ]
      : []),
  ];

  const gridClass =
    items.length >= 3 ? "grid-cols-3" : items.length === 2 ? "grid-cols-2" : "grid-cols-1";

  const colorMap = {
    emerald: { bg: "bg-emerald-50", icon: "text-emerald-600" },
    blue: { bg: "bg-blue-50", icon: "text-blue-600" },
    amber: { bg: "bg-amber-50", icon: "text-amber-600" },
  };

  return (
    <div className={`grid gap-4 ${gridClass}`}>
      {items.map((item) => {
        const c = colorMap[item.color];
        return (
          <div
            key={item.label}
            className="bg-white rounded-xl border border-slate-200 p-4 text-center"
          >
            <div
              className={`w-10 h-10 ${c.bg} rounded-lg flex items-center justify-center mx-auto mb-3`}
            >
              <span className={c.icon}>{item.icon}</span>
            </div>
            <p className="text-2xl font-semibold text-slate-900">
              {item.value}
              {item.suffix && (
                <span className="text-sm font-normal text-slate-400 ml-1">
                  {item.suffix}
                </span>
              )}
            </p>
            <p className="text-xs text-slate-500 mt-1">{item.label}</p>
          </div>
        );
      })}
    </div>
  );
}
