import { CheckCircle2, Globe, Zap } from "lucide-react";
import type { MonthlyReport } from "~/types";

const colorMap = {
  emerald: { bg: "bg-emerald-50", icon: "text-emerald-600", value: "text-emerald-700" },
  blue:    { bg: "bg-blue-50",    icon: "text-blue-600",    value: "text-blue-700" },
  amber:   { bg: "bg-amber-50",   icon: "text-amber-600",   value: "text-amber-700" },
};

export default function ReportStats({ report }: { report: MonthlyReport }) {
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
      label: "อัพไทม์ (30 วัน)",
      value: report.uptime_percent != null ? `${report.uptime_percent.toFixed(2)}%` : "—",
      color: "blue" as const,
    },
    ...(report.speed_score != null
      ? [{
          icon: <Zap className="w-5 h-5" />,
          label: "คะแนนสปีด",
          value: String(report.speed_score),
          suffix: "/ 100",
          color: "amber" as const,
        }]
      : []),
  ];

  return (
    <div className={`grid gap-4 ${items.length >= 3 ? "grid-cols-3" : items.length === 2 ? "grid-cols-2" : "grid-cols-1"}`}>
      {items.map((item) => {
        const c = colorMap[item.color];
        return (
          <div key={item.label} className="bg-white rounded-xl border border-slate-200 p-5 flex items-center gap-4">
            <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${c.bg} ${c.icon}`}>
              {item.icon}
            </span>
            <div>
              <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">{item.label}</p>
              <p className={`text-2xl font-semibold leading-tight ${c.value}`}>
                {item.value}
                {item.suffix && (
                  <span className="text-sm font-normal text-slate-500 ml-1">{item.suffix}</span>
                )}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
