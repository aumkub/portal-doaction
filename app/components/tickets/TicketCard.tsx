import { Link } from "react-router";
import type { SupportTicket } from "~/types";
import { formatDate } from "~/lib/utils";
import StatusBadge from "~/components/tickets/StatusBadge";
import PriorityBadge from "~/components/tickets/PriorityBadge";

export default function TicketCard({ ticket }: { ticket: SupportTicket }) {
  return (
    <Link
      to={`/tickets/${ticket.id}`}
      className="block rounded-xl border border-slate-200 bg-white p-4 transition-colors hover:border-slate-300"
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-slate-400">#{ticket.id}</p>
          <h3 className="mt-1 text-sm font-semibold text-slate-900">
            {ticket.title}
          </h3>
        </div>
        <StatusBadge status={ticket.status} />
      </div>
      <div className="flex items-center justify-between gap-3">
        <PriorityBadge priority={ticket.priority} />
        <p className="text-xs text-slate-500">{formatDate(ticket.created_at)}</p>
      </div>
    </Link>
  );
}
