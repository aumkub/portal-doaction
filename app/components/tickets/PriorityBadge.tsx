import type { TicketPriority } from "~/types";

const priorityConfig: Record<
  TicketPriority,
  { label: string; className: string }
> = {
  low: { label: "Low", className: "bg-slate-100 text-slate-700" },
  medium: { label: "Medium", className: "bg-violet-50 text-violet-700" },
  high: { label: "High", className: "bg-orange-50 text-orange-700" },
  urgent: { label: "Urgent", className: "bg-rose-50 text-rose-700" },
};

export default function PriorityBadge({
  priority,
}: {
  priority: TicketPriority;
}) {
  const config = priorityConfig[priority];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${config.className}`}
    >
      {config.label}
    </span>
  );
}
