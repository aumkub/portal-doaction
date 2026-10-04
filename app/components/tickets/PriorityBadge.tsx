import type { TicketPriority } from "~/types";
import { useT } from "~/lib/i18n";
import type { TranslationKey } from "~/lib/translations";

const priorityClass: Record<TicketPriority, string> = {
  low:    "bg-paper text-muted-ink",
  medium: "bg-sky-50 text-sky-700",
  high:   "bg-[#FFF6C2] text-[#6B5B00]",
  urgent: "bg-[#FDE7DA] text-[#B4541A]",
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
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${priorityClass[priority]}`}
    >
      {t(priorityKey[priority])}
    </span>
  );
}
