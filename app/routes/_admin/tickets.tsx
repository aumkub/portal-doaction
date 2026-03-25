import { requireAdmin } from "~/lib/auth.server";
import StatusBadge from "~/components/tickets/StatusBadge";
import PriorityBadge from "~/components/tickets/PriorityBadge";

type AdminTicket = {
  id: string;
  title: string;
  status: "open" | "in_progress" | "waiting" | "resolved" | "closed";
  priority: "low" | "medium" | "high" | "urgent";
  company_name: string;
  created_at: number;
};

export function meta() {
  return [{ title: "All Tickets — Admin" }];
}

export async function loader({ request, context }: any) {
  await requireAdmin(request, context.cloudflare.env.DB, context.cloudflare.env.SESSION_KV);
  const result = (await context.cloudflare.env.DB.prepare(
    `SELECT t.id, t.title, t.status, t.priority, t.created_at, c.company_name
     FROM support_tickets t
     JOIN clients c ON c.id = t.client_id
     ORDER BY t.updated_at DESC`
  ).all()) as { results: AdminTicket[] };

  return { tickets: result.results };
}

export default function AdminTicketsPage({ loaderData }: any) {
  const { tickets } = loaderData as { tickets: AdminTicket[] };
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">All Tickets</h1>
        <p className="mt-1 text-sm text-slate-500">
          ดู tickets ทั้งหมดจากลูกค้าและติดตามสถานะ
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
              <th className="px-4 py-3">Ticket</th>
              <th className="px-4 py-3">Client</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Priority</th>
            </tr>
          </thead>
          <tbody>
            {tickets.length ? (
              tickets.map((ticket) => (
                <tr key={ticket.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-900">{ticket.title}</p>
                    <p className="text-xs text-slate-400">#{ticket.id}</p>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{ticket.company_name}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={ticket.status} />
                  </td>
                  <td className="px-4 py-3">
                    <PriorityBadge priority={ticket.priority} />
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-slate-400">
                  No tickets
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
