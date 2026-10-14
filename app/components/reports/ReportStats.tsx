import { CheckCircle2, Globe, Zap } from "lucide-react";
import type { MonthlyReport } from "~/types";

const colorMap = {
  emerald: { bg: "bg-emerald-50", icon: "text-emerald-600", value: "text-ink" },
  blue:    { bg: "bg-slate-100",    icon: "text-ink-soft",    value: "text-ink" },
  amber:   { bg: "bg-amber-50",   icon: "text-amber-600",   value: "text-ink" },
};

export default function ReportStats({ report }: { report: MonthlyReport }) {
  const items = [
    {
      icon: <CheckCircle2 className="w-4 h-4" />,
      label: "งานทั้งหมด",
      value: String(report.total_tasks),
      suffix: "รายการ",
      color: "emerald" as const,
    },
    {
      icon: <Globe className="w-4 h-4" />,
      label: "อัพไทม์ (30 วัน)",
      value: report.uptime_percent != null ? `${report.uptime_percent.toFixed(2)}%` : "—",
      color: "blue" as const,
    },
    ...(report.speed_score != null
      ? [{
          icon: <Zap className="w-4 h-4" />,
          label: "คะแนนสปีด",
          value: String(report.speed_score),
          suffix: "/ 100",
          color: "amber" as const,
        }]
      : []),
  ];

  return (
    <div className={`grid gap-3 grid-cols-1 ${items.length >= 3 ? "sm:grid-cols-3" : items.length === 2 ? "sm:grid-cols-2" : ""}`}>
      {items.map((item) => {
        const c = colorMap[item.color];
        return (
          <div key={item.label} className="bg-white rounded-[20px] border border-line p-5 flex items-center gap-4">
            <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-paper text-ink`}>
              {item.icon}
            </span>
            <div>
              <p className="text-xs font-medium text-muted-ink">{item.label}</p>
              <p className={`font-display text-[28px] font-bold tracking-[-0.03em] tabular-nums leading-tight ${c.value}`}>
                {item.value}
                {item.suffix && (
                  <span className="text-sm font-normal text-muted-ink ml-1">{item.suffix}</span>
                )}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
