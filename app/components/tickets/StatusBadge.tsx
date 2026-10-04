import type { TicketStatus } from "~/types";
import { useT } from "~/lib/i18n";
import type { TranslationKey } from "~/lib/translations";

const statusClass: Record<TicketStatus, string> = {
  open:        "bg-[#FDE7DA] text-[#B4541A]",
  in_progress: "bg-sky-50 text-sky-700",
  waiting:     "bg-[#FFF6C2] text-[#6B5B00]",
  resolved:    "bg-emerald-50 text-emerald-700",
  closed:      "bg-ink text-white",
};

const statusKey: Record<TicketStatus, TranslationKey> = {
  open:        "status_open",
  in_progress: "status_in_progress",
  waiting:     "status_waiting",
  resolved:    "status_resolved",
  closed:      "status_closed",
};

export default function StatusBadge({ status }: { status: TicketStatus }) {
  const { t } = useT();
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusClass[status]}`}
    >
      {t(statusKey[status])}
    </span>
  );
}
