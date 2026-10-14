import { Form } from "react-router";
import { ConfirmButton } from "~/components/ui/confirm-button";
import type { SupportTicket } from "~/types";
import { formatDate } from "~/lib/utils";
import StatusBadge from "~/components/tickets/StatusBadge";
import PriorityBadge from "~/components/tickets/PriorityBadge";
import { FaTrash, FaArrowRight } from "react-icons/fa6";

export default function TicketCard({ ticket }: { ticket: SupportTicket }) {
  const canDelete = ticket.status === "open";

  return (
    <div className="rounded-[20px] border border-line bg-white transition-colors hover:border-line">
      {/* Clickable main area → ticket detail */}
      <a
        href={`/tickets/${ticket.id}`}
        className="block p-4 pb-3"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium text-stone">#{ticket.id.slice(0, 8)}</p>
            <h3 className="mt-1 text-sm font-semibold text-ink leading-snug truncate">
              {ticket.title}
            </h3>
          </div>
          <StatusBadge status={ticket.status} />
        </div>
        <div className="flex items-center justify-between gap-3">
          <PriorityBadge priority={ticket.priority} />
          <p className="text-xs text-steel">{formatDate(ticket.created_at)}</p>
        </div>
      </a>

      {/* Footer row: view link + delete */}
      <div className="flex items-center justify-between gap-2 border-t border-hairline px-4 py-2.5">
        <a
          href={`/tickets/${ticket.id}`}
          className="inline-flex items-center gap-1 text-xs font-medium text-ink hover:underline underline-offset-4"
        >
          ดูรายละเอียด
          <FaArrowRight className="text-[9px]" />
        </a>

        {canDelete && (
          <Form method="post">
            <input type="hidden" name="intent" value="delete" />
            <input type="hidden" name="ticketId" value={ticket.id} />
            <ConfirmButton
              message="Ticket จะถูกย้ายไปยังถังขยะ"
              confirmLabel="ลบ Ticket"
              destructive
              className="inline-flex items-center gap-1.5 rounded-md border border-rose-200 bg-white px-2.5 py-1 text-[11px] font-medium text-rose-600 hover:bg-rose-50 transition-colors"
            >
              <FaTrash className="text-[9px]" />
              ลบ
            </ConfirmButton>
          </Form>
        )}
      </div>
    </div>
  );
}
