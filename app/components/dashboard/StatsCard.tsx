import type { ReactNode } from "react";
import { cn } from "~/lib/utils";

type Color = "emerald" | "blue" | "amber" | "violet";

interface Trend {
  value: number; // positive = up, negative = down
  label: string;
}

interface StatsCardProps {
  title: string;
  value: string | number;
  icon: ReactNode;
  color: Color;
  trend?: Trend;
  suffix?: string;
}

const colorMap: Record<Color, { bg: string; icon: string; trend: string }> = {
  emerald: {
    bg: "bg-emerald-50",
    icon: "text-emerald-600",
    trend: "text-emerald-600",
  },
  blue: { bg: "bg-blue-50", icon: "text-blue-600", trend: "text-blue-600" },
  amber: {
    bg: "bg-amber-50",
    icon: "text-amber-600",
    trend: "text-amber-600",
  },
  violet: {
    bg: "bg-violet-50",
    icon: "text-violet-600",
    trend: "text-violet-600",
  },
};

export default function StatsCard({
  title,
  value,
  icon,
  color,
  trend,
  suffix,
}: StatsCardProps) {
  const c = colorMap[color];

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-4">
        <div
          className={cn(
            "w-10 h-10 rounded-lg flex items-center justify-center",
            c.bg
          )}
        >
          <span className={cn("w-5 h-5", c.icon)}>{icon}</span>
        </div>
        {trend && (
          <span
            className={cn(
              "text-xs font-medium flex items-center gap-0.5",
              trend.value >= 0 ? "text-emerald-600" : "text-red-500"
            )}
          >
            {trend.value >= 0 ? "↑" : "↓"} {Math.abs(trend.value)}%{" "}
            <span className="text-slate-400 font-normal">{trend.label}</span>
          </span>
        )}
      </div>
      <p className="text-2xl font-semibold text-slate-900 leading-none">
        {value}
        {suffix && (
          <span className="text-sm font-normal text-slate-400 ml-1">
            {suffix}
          </span>
        )}
      </p>
      <p className="text-sm text-slate-500 mt-1">{title}</p>
    </div>
  );
}
