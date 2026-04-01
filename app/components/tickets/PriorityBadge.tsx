import type { TicketPriority } from "~/types";
import { useT } from "~/lib/i18n";
import type { TranslationKey } from "~/lib/translations";

const priorityClass: Record<TicketPriority, string> = {
  low: "bg-slate-100 text-slate-700",
  medium: "bg-violet-50 text-violet-700",
  high: "bg-orange-50 text-orange-700",
  urgent: "bg-rose-50 text-rose-700",
};

const priorityKey: Record<TicketPriority, TranslationKey> = {
  low: "priority_low",
  medium: "priority_medium",
  high: "priority_high",
  urgent: "priority_urgent",
};

export default function PriorityBadge({ priority }: { priority: TicketPriority }) {
  const { t } = useT();
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${priorityClass[priority]}`}
    >
      {t(priorityKey[priority])}
    </span>
  );
}
