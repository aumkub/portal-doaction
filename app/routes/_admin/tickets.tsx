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

  let assignedClientIds: string[] | undefined;
  if (user.role === "co-admin") {
    const assignments = await db.listCoAdminClients(user.id);
    assignedClientIds = assignments.map((a) => a.client_id);
  }

  const allTickets = await db.listTicketsWithClient(assignedClientIds);

  const counts: Record<string, number> = { all: allTickets.length };
  for (const t of allTickets) {
    counts[t.status] = (counts[t.status] ?? 0) + 1;
  }

  return { tickets: allTickets, counts, userRole: user.role };
}

const statusConfig: Record<string, { badge: string; dot: string }> = {
  open:        { badge: "bg-[#FDE7DA] text-[#B4541A]", dot: "bg-[#B4541A]" },
  in_progress: { badge: "bg-sky-50 text-sky-700",       dot: "bg-sky-500" },
  waiting:     { badge: "bg-[#FFF6C2] text-[#6B5B00]",  dot: "bg-[#6B5B00]" },
  resolved:    { badge: "bg-emerald-50 text-emerald-700", dot: "bg-emerald-500" },
  closed:      { badge: "bg-ink text-white",            dot: "bg-brand-yellow" },
};

const priorityConfig: Record<string, { color: string; dot: string }> = {
  low:    { color: "text-muted-ink", dot: "bg-line" },
  medium: { color: "text-muted-ink", dot: "bg-sky-400" },
  high:   { color: "text-[#6B5B00]", dot: "bg-brand-yellow" },
  urgent: { color: "text-[#B4541A]",  dot: "bg-[#B4541A]" },
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
    "bg-paper text-muted-ink",
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
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted-ink">
            {t("admin_tickets_page_subtitle").replace("{count}", String(counts.all ?? 0))}
          </p>
          <h1 className="mt-1 text-[28px] md:text-[32px] font-bold tracking-[-0.02em] text-ink">{t("admin_tickets_page_title")}</h1>
        </div>
        <a
          href="/admin/tickets/trash"
          className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border border-line bg-white px-5 text-[13px] font-semibold text-ink-soft hover:bg-paper transition-colors"
        >
          <FaTrash className="text-[10px] text-faint-ink" />
          ถังขยะ
        </a>
      </div>

      {/* ── Filter pills + search ── */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1">
          <div className="inline-flex flex-wrap rounded-[20px] sm:rounded-full bg-paper p-[3px]">
          {FILTERS.map((s) => {
            const count = counts[s] ?? 0;
            const isActive = filter === s;
            return (
              <button
                key={s}
                type="button"
                onClick={() => setFilter(s)}
                className={`inline-flex h-8 items-center gap-1.5 px-3.5 rounded-full text-[13px] font-medium transition-colors ${
                  isActive
                    ? "bg-white text-ink shadow-[0_1px_2px_rgba(0,0,0,0.08)]"
                    : "text-muted-ink hover:text-ink"
                }`}
              >
                {t(filterKey[s])}
                {count > 0 && (
                  <span
                    className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full text-[10px] font-semibold tabular-nums ${
                      isActive
                        ? "bg-paper text-ink-soft"
                        : s === "open"
                        ? "bg-brand-yellow text-ink"
                        : s === "in_progress"
                        ? "bg-sky-50 text-sky-700"
                        : "bg-line/70 text-muted-ink"
                    }`}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
          </div>
        </div>
        <div className="relative sm:w-60 shrink-0">
          <FaMagnifyingGlass className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-ink text-xs" />
          <input
            type="search"
            placeholder="ค้นหา..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-10 w-full rounded-xl border border-line bg-white pl-8 pr-3 text-sm placeholder:text-faint-ink focus:outline-none focus:ring-2 focus:ring-ink/10 focus:border-ink/40 transition"
          />
        </div>
      </div>

      {/* ── List ── */}
      <div className="overflow-hidden rounded-[20px] border border-line bg-white ">
        {filtered.length === 0 ? (
          <div className="px-5 py-16 text-center">
            <div className="flex flex-col items-center gap-3 text-muted-ink">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-paper text-faint-ink"><FaTicket className="text-base" /></span>
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
                  <tr className="border-b border-line-soft text-xs font-medium text-muted-ink">
                    <th className="text-left px-5 py-3">{t("admin_tickets_col_company")}</th>
                    <th className="text-left px-5 py-3">{t("admin_tickets_col_subject")}</th>
                    <th className="text-left px-5 py-3">{t("admin_tickets_col_priority")}</th>
                    <th className="text-left px-5 py-3">{t("admin_tickets_col_status")}</th>
                    <th className="text-left px-5 py-3">{t("admin_tickets_col_updated")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-soft">
                  {filtered.map((ticket) => {
                    const st = statusConfig[ticket.status] ?? statusConfig.closed;
                    const pr = priorityConfig[ticket.priority] ?? priorityConfig.low;
                    const initials = getInitials(ticket.company_name);
                    const avatarCls = avatarColor(ticket.company_name);
                    return (
                      <tr
                        key={ticket.id}
                        className="hover:bg-paper transition-colors cursor-pointer"
                        onClick={() => { window.location.href = `/admin/tickets/${ticket.id}`; }}
                      >
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-2">
                            <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-[8px] text-[9px] font-bold ${avatarCls}`}>{initials}</span>
                            <span className="text-xs text-muted-ink">{ticket.company_name}</span>
                          </div>
                        </td>
                        <td className="px-5 py-3.5 font-medium text-ink max-w-[240px]">
                          <a
                            href={`/admin/tickets/${ticket.id}`}
                            className="truncate block underline-offset-4 hover:underline"
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
                          <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-0.5 rounded-full font-semibold ${st.badge}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />
                            {t(ticketStatusKey(ticket.status))}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-muted-ink text-xs whitespace-nowrap">
                          {formatRelativeTime(ticket.updated_at, lang)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Cards — below lg */}
            <div className="lg:hidden divide-y divide-line-soft">
              {filtered.map((ticket) => {
                const st = statusConfig[ticket.status] ?? statusConfig.closed;
                const pr = priorityConfig[ticket.priority] ?? priorityConfig.low;
                const initials = getInitials(ticket.company_name);
                const avatarCls = avatarColor(ticket.company_name);
                return (
                  <a
                    key={ticket.id}
                    href={`/admin/tickets/${ticket.id}`}
                    className="flex items-start gap-3 p-4 hover:bg-paper transition-colors"
                  >
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] text-xs font-semibold mt-0.5 ${avatarCls}`}>
                      {initials}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-ink truncate">{ticket.title}</p>
                      <p className="text-xs text-muted-ink mt-0.5">{ticket.company_name}</p>
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-0.5 rounded-full font-semibold ${st.badge}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />
                          {t(ticketStatusKey(ticket.status))}
                        </span>
                        <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${pr.color}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${pr.dot}`} />
                          {t(priorityKey[ticket.priority])}
                        </span>
                        <span className="text-xs text-faint-ink">{formatRelativeTime(ticket.updated_at, lang)}</span>
                      </div>
                    </div>
                  </a>
                );
              })}
            </div>
          </>
        )}

        {filtered.length > 0 && (
          <div className="border-t border-line-soft px-5 py-2.5 bg-paper/40">
            <p className="text-xs text-muted-ink">แสดง {filtered.length} จาก {tickets.length} รายการ</p>
          </div>
        )}
      </div>
    </div>
  );
}
