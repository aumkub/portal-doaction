import type { TicketStatus } from "~/types";
import { translations, type Lang } from "~/lib/translations";

const STEP_KEYS = [
  "rd_ticket_step_received",
  "rd_ticket_step_working",
  "rd_ticket_step_waiting",
  "rd_ticket_step_done",
] as const;

const STATUS_STEP: Record<TicketStatus, number> = {
  open: 0,
  in_progress: 1,
  waiting: 2,
  resolved: 3,
  closed: 3,
};

/** 4-segment progress: open → in_progress → waiting → resolved/closed */
export function StatusStepper({ status, lang }: { status: TicketStatus; lang: Lang }) {
  const current = STATUS_STEP[status] ?? 0;
  const dict = translations[lang] ?? translations.th;
  return (
    <div className="grid max-w-[560px] grid-cols-4 gap-1.5" aria-label="Ticket progress">
      {STEP_KEYS.map((key, i) => (
        <div key={key} className="min-w-0">
          <span className={`block h-1 rounded-full ${i <= current ? "bg-ink" : "bg-[#E6E3DA]"}`} />
          <span
            className={`mt-1.5 block truncate text-[11px] ${
              i === current ? "font-bold text-ink" : "font-medium text-faint-ink"
            }`}
          >
            {dict[key]}
          </span>
        </div>
      ))}
    </div>
  );
}

export default StatusStepper;
