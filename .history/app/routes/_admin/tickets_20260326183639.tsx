import type { Route } from "./+types/tickets";
import { requireAdmin } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";
import { formatRelativeTime } from "~/lib/utils";
import PageHeader from "~/components/layout/PageHeader";
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

  const url = new URL(request.url);
  const filter = url.searchParams.get("status") ?? "all";
  const filtered =
    filter === "all"
      ? allTickets
      : allTickets.filter((t) => t.status === filter);

  return { tickets: filtered.slice(0, 50), filter, counts };
}

const statusConfig = {
  open:        { label: "เปิด",         color: "bg-amber-50 text-amber-600" },
  in_progress: { label: "กำลังดำเนิน",  color: "bg-blue-50 text-blue-600" },
  waiting:     { label: "รอข้อมูล",      color: "bg-slate-100 text-slate-600" },
  resolved:    { label: "เสร็จสิ้น",     color: "bg-emerald-50 text-emerald-600" },
  closed:      { label: "ปิดแล้ว",       color: "bg-slate-100 text-slate-400" },
};

const priorityConfig = {
  low:    { label: "ต่ำ",      color: "text-slate-400" },
  medium: { label: "กลาง",    color: "text-blue-500" },
  high:   { label: "สูง",      color: "text-amber-500" },
  urgent: { label: "เร่งด่วน", color: "text-red-500" },
};

const FILTERS = ["all", "open", "in_progress", "waiting", "resolved", "closed"] as const;

export default function AdminTicketsPage({ loaderData }: Route.ComponentProps) {
  const { tickets, filter, counts } = loaderData as {
    tickets: (SupportTicket & { company_name: string })[];
    filter: string;
    counts: Record<string, number>;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="จัดการ Tickets"
        subtitle={`${counts.all ?? 0} รายการทั้งหมด`}
        breadcrumbs={[{ label: "Admin" }, { label: "Tickets" }]}
      />

      {/* Filters with counts */}
      <div className="flex gap-2 flex-wrap">
        {FILTERS.map((s) => {
          const count = counts[s] ?? 0;
          const isActive = filter === s;
          const label =
            s === "all" ? "ทั้งหมด" : statusConfig[s as keyof typeof statusConfig]?.label ?? s;
          return (
            <a
              key={s}
              href={`/admin/tickets?status=${s}`}
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
            </a>
          );
        })}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="text-left text-xs font-medium text-slate-500 px-5 py-3">ลูกค้า</th>
              <th className="text-left text-xs font-medium text-slate-500 px-5 py-3">หัวข้อ</th>
              <th className="text-left text-xs font-medium text-slate-500 px-5 py-3">ความสำคัญ</th>
              <th className="text-left text-xs font-medium text-slate-500 px-5 py-3">สถานะ</th>
              <th className="text-left text-xs font-medium text-slate-500 px-5 py-3">อัปเดต</th>
            </tr>
          </thead>
          <tbody>
            {tickets.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-5 py-12 text-center text-slate-400">
                  ไม่มี Ticket
                </td>
              </tr>
            ) : (
              tickets.map((ticket) => {
                const st = statusConfig[ticket.status];
                const pr = priorityConfig[ticket.priority];
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
                    <td className={`px-5 py-4 text-xs font-medium ${pr.color}`}>
                      {pr.label}
                    </td>
                    <td className="px-5 py-4">
                      <span
                        className={`text-xs font-medium px-2 py-0.5 rounded-full ${st.color}`}
                      >
                        {st.label}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-slate-400 text-xs">
                      {formatRelativeTime(ticket.updated_at)}
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
