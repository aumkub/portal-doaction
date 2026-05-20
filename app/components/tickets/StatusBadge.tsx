import type { TicketStatus } from "~/types";
import { useT } from "~/lib/i18n";
import type { TranslationKey } from "~/lib/translations";

const statusClass: Record<TicketStatus, string> = {
  open:        "bg-surface-yellow text-yellow-dark",
  in_progress: "bg-surface-pricing-featured text-brand-blue",
  waiting:     "bg-surface text-muted-foreground",
  resolved:    "bg-teal-light text-moss-dark",
  closed:      "bg-hairline-soft text-steel",
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
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass[status]}`}
    >
      {t(statusKey[status])}
    </span>
  );
}
