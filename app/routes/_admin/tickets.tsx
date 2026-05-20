import type { Route } from "./+types/tickets";
import { useState, useMemo } from "react";
import { requireCoAdminOrAdmin } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";
import { formatRelativeTime } from "~/lib/utils";
import { useT } from "~/lib/i18n";
import type { TranslationKey } from "~/lib/translations";
import type { SupportTicket } from "~/types";
import { FaMagnifyingGlass, FaTicket, FaTrash } from "react-icons/fa6";

export function meta() {
  return [{ title: "จัดการ Tickets — Admin" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const user = await requireCoAdminOrAdmin(request, env.DB, env.SESSIONPORTAL);
  const db = createDB(env.DB);

  let clients;
  if (user.role === "co-admin") {
    const assignments = await db.listCoAdminClients(user.id);
    const clientIds = assignments.map((a) => a.client_id);
    clients = (await db.listClients()).filter((c) => clientIds.includes(c.id));
  } else {
    clients = await db.listClients();
  }

  const ticketBuckets = await Promise.all(
    clients.map(async (client) => {
      const tickets = await db.listTicketsByClient(client.id);
      return tickets.map((t) => ({ ...t, company_name: client.company_name }));
    })
  );
  const allTickets = ticketBuckets.flat();
  allTickets.sort((a, b) => b.updated_at - a.updated_at);

  const counts: Record<string, number> = { all: allTickets.length };
  for (const t of allTickets) {
    counts[t.status] = (counts[t.status] ?? 0) + 1;
  }

  return { tickets: allTickets, counts, userRole: user.role };
}

const statusConfig: Record<string, { badge: string; dot: string }> = {
  open:        { badge: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",   dot: "bg-amber-500 animate-pulse" },
  in_progress: { badge: "bg-blue-50 text-blue-600 ring-1 ring-blue-200",      dot: "bg-blue-500" },
  waiting:     { badge: "bg-slate-100 text-slate-600 ring-1 ring-slate-200",  dot: "bg-slate-400" },
  resolved:    { badge: "bg-emerald-50 text-emerald-600 ring-1 ring-emerald-200", dot: "bg-emerald-500" },
  closed:      { badge: "bg-slate-100 text-slate-500 ring-1 ring-slate-200",  dot: "bg-slate-300" },
};

const priorityConfig: Record<string, { color: string; dot: string }> = {
  low:    { color: "text-slate-500", dot: "bg-slate-300" },
  medium: { color: "text-blue-500",  dot: "bg-blue-400" },
  high:   { color: "text-amber-500", dot: "bg-amber-500" },
  urgent: { color: "text-red-500",   dot: "bg-red-500" },
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

function getInitials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}
function avatarColor(name: string) {
  const colors = [
    "bg-violet-100 text-violet-700", "bg-blue-100 text-blue-700",
    "bg-emerald-100 text-emerald-700", "bg-orange-100 text-orange-700",
    "bg-rose-100 text-rose-700", "bg-indigo-100 text-indigo-700",
    "bg-teal-100 text-teal-700", "bg-pink-100 text-pink-700",
  ];
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) & 0xffff;
  return colors[hash % colors.length];
}

export default function AdminTicketsPage({ loaderData }: Route.ComponentProps) {
  const { tickets, counts } = loaderData as {
    tickets: (SupportTicket & { company_name: string })[];
    counts: Record<string, number>;
  };
  const { t, lang } = useT();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return tickets.filter((tick) => {
      const matchesStatus = filter === "all" || tick.status === filter;
      const matchesSearch =
        !q ||
        tick.title.toLowerCase().includes(q) ||
        tick.company_name.toLowerCase().includes(q);
      return matchesStatus && matchesSearch;
    });
  }, [tickets, filter, search]);

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{t("admin_tickets_page_title")}</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            {t("admin_tickets_page_subtitle").replace("{count}", String(counts.all ?? 0))}
          </p>
        </div>
        <a
          href="/admin/tickets/trash"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:border-slate-300 transition-colors"
        >
          <FaTrash className="text-[10px] text-slate-400" />
          ถังขยะ
        </a>
      </div>

      {/* ── Filter pills + search ── */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex gap-2 flex-wrap flex-1">
          {FILTERS.map((s) => {
            const count = counts[s] ?? 0;
            const isActive = filter === s;
            return (
              <button
                key={s}
                type="button"
                onClick={() => setFilter(s)}
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${
                  isActive
                    ? "bg-slate-900 text-white border-slate-900"
                    : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-slate-300"
                }`}
              >
                {t(filterKey[s])}
                {count > 0 && (
                  <span
                    className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-semibold ${
                      isActive
                        ? "bg-white/20 text-white"
                        : s === "open"
                        ? "bg-amber-100 text-amber-700"
                        : s === "in_progress"
                        ? "bg-blue-100 text-blue-700"
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
        <div className="relative sm:w-60 shrink-0">
          <FaMagnifyingGlass className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-xs" />
          <input
            type="search"
            placeholder="ค้นหา..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white pl-8 pr-3 py-2 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-400 transition"
          />
        </div>
      </div>

      {/* ── List ── */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="px-5 py-16 text-center">
            <div className="flex flex-col items-center gap-2 text-slate-500">
              <FaTicket className="text-3xl opacity-30" />
              <p className="text-sm">
                {search || filter !== "all" ? "ไม่พบ Ticket ที่ค้นหา" : t("admin_tickets_empty")}
              </p>
            </div>
          </div>
        ) : (
          <>
            {/* Desktop table — lg+ */}
            <div className="hidden lg:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/60">
                    <th className="text-left text-xs font-medium text-slate-500 px-5 py-3">{t("admin_tickets_col_company")}</th>
                    <th className="text-left text-xs font-medium text-slate-500 px-5 py-3">{t("admin_tickets_col_subject")}</th>
                    <th className="text-left text-xs font-medium text-slate-500 px-5 py-3">{t("admin_tickets_col_priority")}</th>
                    <th className="text-left text-xs font-medium text-slate-500 px-5 py-3">{t("admin_tickets_col_status")}</th>
                    <th className="text-left text-xs font-medium text-slate-500 px-5 py-3">{t("admin_tickets_col_updated")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map((ticket) => {
                    const st = statusConfig[ticket.status] ?? statusConfig.closed;
                    const pr = priorityConfig[ticket.priority] ?? priorityConfig.low;
                    const initials = getInitials(ticket.company_name);
                    const avatarCls = avatarColor(ticket.company_name);
                    return (
                      <tr
                        key={ticket.id}
                        className="hover:bg-slate-50/70 transition-colors cursor-pointer"
                        onClick={() => { window.location.href = `/admin/tickets/${ticket.id}`; }}
                      >
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-2">
                            <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[9px] font-bold ${avatarCls}`}>{initials}</span>
                            <span className="text-xs text-slate-500">{ticket.company_name}</span>
                          </div>
                        </td>
                        <td className="px-5 py-3.5 font-medium text-slate-900 max-w-[240px]">
                          <a
                            href={`/admin/tickets/${ticket.id}`}
                            className="truncate block hover:text-violet-600 transition-colors"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {ticket.title}
                          </a>
                        </td>
                        <td className="px-5 py-3.5">
                          <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${pr.color}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${pr.dot}`} />
                            {t(priorityKey[ticket.priority])}
                          </span>
                        </td>
                        <td className="px-5 py-3.5">
                          <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${st.badge}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />
                            {t(ticketStatusKey(ticket.status))}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-slate-500 text-xs whitespace-nowrap">
                          {formatRelativeTime(ticket.updated_at, lang)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Cards — below lg */}
            <div className="lg:hidden divide-y divide-slate-100">
              {filtered.map((ticket) => {
                const st = statusConfig[ticket.status] ?? statusConfig.closed;
                const pr = priorityConfig[ticket.priority] ?? priorityConfig.low;
                const initials = getInitials(ticket.company_name);
                const avatarCls = avatarColor(ticket.company_name);
                return (
                  <a
                    key={ticket.id}
                    href={`/admin/tickets/${ticket.id}`}
                    className="flex items-start gap-3 p-4 hover:bg-slate-50 transition-colors"
                  >
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold mt-0.5 ${avatarCls}`}>
                      {initials}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-900 truncate">{ticket.title}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{ticket.company_name}</p>
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-0.5 rounded-full ${st.badge}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />
                          {t(ticketStatusKey(ticket.status))}
                        </span>
                        <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${pr.color}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${pr.dot}`} />
                          {t(priorityKey[ticket.priority])}
                        </span>
                        <span className="text-xs text-slate-400">{formatRelativeTime(ticket.updated_at, lang)}</span>
                      </div>
                    </div>
                  </a>
                );
              })}
            </div>
          </>
        )}

        {filtered.length > 0 && (
          <div className="border-t border-slate-100 px-5 py-2.5 bg-slate-50/40">
            <p className="text-xs text-slate-500">แสดง {filtered.length} จาก {tickets.length} รายการ</p>
          </div>
        )}
      </div>
    </div>
  );
}
