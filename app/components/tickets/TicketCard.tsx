import { Form } from "react-router";
import type { SupportTicket } from "~/types";
import { formatDate } from "~/lib/utils";
import StatusBadge from "~/components/tickets/StatusBadge";
import PriorityBadge from "~/components/tickets/PriorityBadge";
import { FaTrash, FaArrowRight } from "react-icons/fa6";

export default function TicketCard({ ticket }: { ticket: SupportTicket }) {
  const canDelete = ticket.status === "open";

  return (
    <div className="rounded-xl border border-hairline bg-canvas transition-colors hover:border-hairline-strong hover:shadow-sm">
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
          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline underline-offset-2"
        >
          ดูรายละเอียด
          <FaArrowRight className="text-[9px]" />
        </a>

        {canDelete && (
          <Form
            method="post"
            onSubmit={(e) => {
              if (!confirm("ลบ Ticket นี้ใช่หรือไม่? Ticket จะถูกย้ายไปยังถังขยะ")) {
                e.preventDefault();
              }
            }}
          >
            <input type="hidden" name="intent" value="delete" />
            <input type="hidden" name="ticketId" value={ticket.id} />
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] font-medium text-red-600 hover:bg-red-100 transition-colors"
            >
              <FaTrash className="text-[9px]" />
              ลบ
            </button>
          </Form>
        )}
      </div>
    </div>
  );
}
