import type { TicketPriority } from "~/types";
import { useT } from "~/lib/i18n";
import type { TranslationKey } from "~/lib/translations";

const priorityClass: Record<TicketPriority, string> = {
  low:    "bg-surface text-muted-foreground",
  medium: "bg-surface-pricing-featured text-brand-blue",
  high:   "bg-surface-yellow text-yellow-dark",
  urgent: "bg-coral-light text-coral-dark",
};

const priorityKey: Record<TicketPriority, TranslationKey> = {
  low:    "priority_low",
  medium: "priority_medium",
  high:   "priority_high",
  urgent: "priority_urgent",
};

export default function PriorityBadge({ priority }: { priority: TicketPriority }) {
  const { t } = useT();
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${priorityClass[priority]}`}
    >
      {t(priorityKey[priority])}
    </span>
  );
}
