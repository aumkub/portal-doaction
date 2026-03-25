import type { TicketStatus } from "~/types";

const statusConfig: Record<TicketStatus, { label: string; className: string }> = {
  open: { label: "Open", className: "bg-amber-50 text-amber-700" },
  in_progress: { label: "In Progress", className: "bg-blue-50 text-blue-700" },
  waiting: { label: "Waiting", className: "bg-slate-100 text-slate-600" },
  resolved: { label: "Resolved", className: "bg-emerald-50 text-emerald-700" },
  closed: { label: "Closed", className: "bg-slate-200 text-slate-600" },
};

export default function StatusBadge({ status }: { status: TicketStatus }) {
  const config = statusConfig[status];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${config.className}`}
    >
      {config.label}
    </span>
  );
}
