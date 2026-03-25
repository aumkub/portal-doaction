import { Link } from "react-router";
import { requireAdmin } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";

type DashboardTicket = {
  id: string;
  title: string;
  priority: string;
  status: string;
  company_name: string;
};

export function meta() {
  return [{ title: "Admin Overview — DoAction Portal" }];
}

export async function loader({ request, context }: any) {
  await requireAdmin(request, context.cloudflare.env.DB, context.cloudflare.env.SESSION_KV);
  const db = createDB(context.cloudflare.env.DB);
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  const [clients, dueReports, openTicketsResult] = await Promise.all([
    db.listClients(),
    context.cloudflare.env.DB.prepare(
      "SELECT COUNT(*) as count FROM monthly_reports WHERE year = ? AND month = ?"
    )
      .bind(year, month)
      .first(),
    context.cloudflare.env.DB.prepare(
      `SELECT t.id, t.title, t.priority, t.status, c.company_name
       FROM support_tickets t
       JOIN clients c ON c.id = t.client_id
       WHERE t.status IN ('open', 'in_progress')
       ORDER BY t.created_at DESC
       LIMIT 6`
    ).all(),
  ]);

  const dueReportCount = (dueReports as { count?: number } | null)?.count ?? 0;
  const urgentTickets = (openTicketsResult as { results?: DashboardTicket[] }).results ?? [];

  return {
    totalClients: clients.length,
    reportsDueThisMonth: dueReportCount,
    openTickets: urgentTickets.length,
    urgentTickets,
    clients: clients.slice(0, 6),
  };
}

export default function AdminOverviewPage({ loaderData }: any) {
  const data = loaderData;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Admin Overview</h1>
        <p className="mt-1 text-sm text-slate-500">
          สรุปภาพรวมลูกค้า รายงาน และ tickets ที่ต้องดูแล
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <p className="text-sm text-slate-500">Total clients</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900">
            {data.totalClients}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <p className="text-sm text-slate-500">Open tickets</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900">
            {data.openTickets}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <p className="text-sm text-slate-500">Reports due this month</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900">
            {data.reportsDueThisMonth}
          </p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">Clients</h2>
            <Link to="/admin/clients" className="text-xs text-violet-600">
              View all
            </Link>
          </div>
          <div className="space-y-2">
            {data.clients.map((client: any) => (
              <div
                key={client.id}
                className="rounded-lg border border-slate-100 px-3 py-2 text-sm text-slate-700"
              >
                {client.company_name}
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">Need quick reply</h2>
            <Link to="/admin/tickets" className="text-xs text-violet-600">
              Open tickets
            </Link>
          </div>
          <div className="space-y-2">
            {data.urgentTickets.length ? (
              data.urgentTickets.map((ticket: DashboardTicket) => (
                <div
                  key={ticket.id}
                  className="rounded-lg border border-slate-100 px-3 py-2"
                >
                  <p className="text-sm font-medium text-slate-800">{ticket.title}</p>
                  <p className="text-xs text-slate-500">{ticket.company_name}</p>
                </div>
              ))
            ) : (
              <p className="text-sm text-slate-400">No urgent replies right now.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
