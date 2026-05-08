import type { ReactNode } from "react";
import { cn } from "~/lib/utils";

type Color = "emerald" | "blue" | "amber" | "violet";

interface Trend {
  value: number;
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
  emerald: { bg: "bg-teal-light",                  icon: "text-moss-dark",    trend: "text-success-accent" },
  blue:    { bg: "bg-surface-pricing-featured",     icon: "text-brand-blue",   trend: "text-brand-blue" },
  amber:   { bg: "bg-surface-yellow",               icon: "text-yellow-dark",  trend: "text-yellow-dark" },
  violet:  { bg: "bg-surface-pricing-featured",     icon: "text-brand-blue",   trend: "text-brand-blue" },
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
    <div className="bg-canvas rounded-xl border border-hairline p-5 hover:shadow-sm transition-shadow">
      <div className="flex items-start justify-between mb-4">
        <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center", c.bg)}>
          <span className={cn("w-5 h-5", c.icon)}>{icon}</span>
        </div>
        {trend && (
          <span className={cn(
            "text-xs font-medium flex items-center gap-0.5",
            trend.value >= 0 ? "text-success-accent" : "text-brand-red-dark"
          )}>
            {trend.value >= 0 ? "↑" : "↓"} {Math.abs(trend.value)}%{" "}
            <span className="text-stone font-normal">{trend.label}</span>
          </span>
        )}
      </div>
      <p className="text-2xl font-semibold text-ink leading-none">
        {value}
        {suffix && (
          <span className="text-sm font-normal text-steel ml-1">{suffix}</span>
        )}
      </p>
      <p className="text-sm text-muted-foreground mt-1">{title}</p>
    </div>
  );
}
