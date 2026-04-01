import type { Route } from "./+types/tickets";
import { useState } from "react";
import { requireAdmin } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";
import { formatRelativeTime } from "~/lib/utils";
import PageHeader from "~/components/layout/PageHeader";
import { useT } from "~/lib/i18n";
import type { TranslationKey } from "~/lib/translations";
import type { SupportTicket } from "~/types";

export function meta() {
  return [{ title: "จัดการ Tickets — Admin" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  await requireAdmin(request, env.DB, env.SESSIONPORTAL);
  const db = createDB(env.DB);

  const clients = await db.listClients();

  // Load tickets for every client in parallel to reduce total latency.
  const ticketBuckets = await Promise.all(
    clients.map(async (client) => {
      const tickets = await db.listTicketsByClient(client.id);
      return tickets.map((t) => ({ ...t, company_name: client.company_name }));
    })
  );
  const allTickets = ticketBuckets.flat();
  allTickets.sort((a, b) => b.updated_at - a.updated_at);

  // Count per status
  const counts: Record<string, number> = { all: allTickets.length };
  for (const t of allTickets) {
    counts[t.status] = (counts[t.status] ?? 0) + 1;
  }

  return { tickets: allTickets, counts };
}

const statusColors: Record<string, string> = {
  open: "bg-amber-50 text-amber-600",
  in_progress: "bg-blue-50 text-blue-600",
  waiting: "bg-slate-100 text-slate-600",
  resolved: "bg-emerald-50 text-emerald-600",
  closed: "bg-slate-100 text-slate-400",
};

const priorityColors: Record<string, string> = {
  low: "text-slate-400",
  medium: "text-blue-500",
  high: "text-amber-500",
  urgent: "text-red-500",
};

const FILTERS = ["all", "open", "in_progress", "waiting", "resolved", "closed"] as const;

const filterKey: Record<(typeof FILTERS)[number], TranslationKey> = {
  all: "tickets_filter_all",
  open: "status_open",
  in_progress: "status_in_progress",
  waiting: "status_waiting",
  resolved: "status_resolved",
  closed: "status_closed_short",
};

function ticketStatusKey(status: SupportTicket["status"]): TranslationKey {
  if (status === "closed") return "status_closed_short";
  return `status_${status}` as TranslationKey;
}

const priorityKey: Record<SupportTicket["priority"], TranslationKey> = {
  low: "priority_low",
  medium: "priority_medium",
  high: "priority_high",
  urgent: "priority_urgent",
};

export default function AdminTicketsPage({ loaderData }: Route.ComponentProps) {
  const { tickets, counts } = loaderData as {
    tickets: (SupportTicket & { company_name: string })[];
    counts: Record<string, number>;
  };
  const { t, lang } = useT();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");

  const filteredTickets =
    filter === "all" ? tickets : tickets.filter((t) => t.status === filter);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("admin_tickets_page_title")}
        subtitle={t("admin_tickets_page_subtitle").replace(
          "{count}",
          String(counts.all ?? 0)
        )}
        breadcrumbs={[
          { label: t("admin_breadcrumb_admin") },
          { label: t("admin_breadcrumb_tickets") },
        ]}
      />

      {/* Filters with counts */}
      <div className="flex gap-2 flex-wrap">
        {FILTERS.map((s) => {
          const count = counts[s] ?? 0;
          const isActive = filter === s;
          const label = t(filterKey[s]);
          return (
            <button
              key={s}
              type="button"
              onClick={() => setFilter(s)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                isActive
                  ? "bg-slate-900 text-white"
                  : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
              }`}
            >
              {label}
              {count > 0 && (
                <span
                  className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-semibold ${
                    isActive
                      ? "bg-white/20 text-white"
                      : s === "open"
                      ? "bg-amber-100 text-amber-700"
                      : s === "in_progress"
                      ? "bg-blue-100 text-blue-700"
                      : s === "waiting"
                      ? "bg-slate-100 text-slate-600"
                      : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="text-left text-xs font-medium text-slate-500 px-5 py-3">
                {t("admin_tickets_col_company")}
              </th>
              <th className="text-left text-xs font-medium text-slate-500 px-5 py-3">
                {t("admin_tickets_col_subject")}
              </th>
              <th className="text-left text-xs font-medium text-slate-500 px-5 py-3">
                {t("admin_tickets_col_priority")}
              </th>
              <th className="text-left text-xs font-medium text-slate-500 px-5 py-3">
                {t("admin_tickets_col_status")}
              </th>
              <th className="text-left text-xs font-medium text-slate-500 px-5 py-3">
                {t("admin_tickets_col_updated")}
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredTickets.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-5 py-12 text-center text-slate-400">
                  {t("admin_tickets_empty")}
                </td>
              </tr>
            ) : (
              filteredTickets.map((ticket) => {
                const stColor = statusColors[ticket.status];
                const prColor = priorityColors[ticket.priority];
                return (
                  <tr
                    key={ticket.id}
                    className="border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors cursor-pointer"
                    onClick={() => {
                      window.location.href = `/admin/tickets/${ticket.id}`;
                    }}
                  >
                    <td className="px-5 py-4 text-slate-500 text-xs">
                      {ticket.company_name}
                    </td>
                    <td className="px-5 py-4 font-medium text-slate-900 max-w-[240px]">
                      <a
                        href={`/admin/tickets/${ticket.id}`}
                        className="truncate block hover:text-violet-600 transition-colors"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {ticket.title}
                      </a>
                    </td>
                    <td className={`px-5 py-4 text-xs font-medium ${prColor}`}>
                      {t(priorityKey[ticket.priority])}
                    </td>
                    <td className="px-5 py-4">
                      <span
                        className={`text-xs font-medium px-2 py-0.5 rounded-full ${stColor}`}
                      >
                        {t(ticketStatusKey(ticket.status))}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-slate-400 text-xs">
                      {formatRelativeTime(ticket.updated_at, lang)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
