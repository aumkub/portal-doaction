import type { TicketStatus } from "~/types";
import { useT } from "~/lib/i18n";
import type { TranslationKey } from "~/lib/translations";

const statusClass: Record<TicketStatus, string> = {
  open: "bg-amber-50 text-amber-700",
  in_progress: "bg-blue-50 text-blue-700",
  waiting: "bg-slate-100 text-slate-600",
  resolved: "bg-emerald-50 text-emerald-700",
  closed: "bg-slate-200 text-slate-600",
};

const statusKey: Record<TicketStatus, TranslationKey> = {
  open: "status_open",
  in_progress: "status_in_progress",
  waiting: "status_waiting",
  resolved: "status_resolved",
  closed: "status_closed",
};

export default function StatusBadge({ status }: { status: TicketStatus }) {
  const { t } = useT();
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${statusClass[status]}`}
    >
      {t(statusKey[status])}
    </span>
  );
}
