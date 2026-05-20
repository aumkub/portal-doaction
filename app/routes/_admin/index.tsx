import { Link } from "react-router";
import { requireCoAdminOrAdmin } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";
import { useT } from "~/lib/i18n";

type DashboardTicket = {
  id: string;
  title: string;
  priority: string;
  status: string;
  company_name: string;
};

type MissingReportClient = {
  id: string;
  company_name: string;
};

export function meta() {
  return [{ title: "Admin Overview — do action portal" }];
}

export async function loader({ request, context }: any) {
  const user = await requireCoAdminOrAdmin(request, context.cloudflare.env.DB, context.cloudflare.env.SESSIONPORTAL);
  const db = createDB(context.cloudflare.env.DB);
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  // For Co-Admins, get their assigned client IDs
  let assignedClientIds: string[] = [];
  if (user.role === "co-admin") {
    const assignments = await db.listCoAdminClients(user.id);
    assignedClientIds = assignments.map((a) => a.client_id);
  }

  // Filter clients for Co-Admins
  const allClients = await db.listClients();
  const clients = user.role === "co-admin"
    ? allClients.filter((c) => assignedClientIds.includes(c.id))
    : allClients;

  // Clients WITHOUT a report this month
  const missingReportQuery = user.role === "co-admin"
    ? `SELECT c.id, c.company_name
       FROM clients c
       LEFT JOIN monthly_reports mr ON mr.client_id = c.id AND mr.year = ? AND mr.month = ?
       WHERE mr.id IS NULL AND c.id IN (${assignedClientIds.map(() => "?").join(",")})
       ORDER BY c.company_name`
    : `SELECT c.id, c.company_name
       FROM clients c
       LEFT JOIN monthly_reports mr ON mr.client_id = c.id AND mr.year = ? AND mr.month = ?
       WHERE mr.id IS NULL
       ORDER BY c.company_name`;

  const missingReportParams = user.role === "co-admin"
    ? [year, month, ...assignedClientIds]
    : [year, month];

  const missingReportResult = user.role === "co-admin" && assignedClientIds.length === 0
    ? { results: [] }
    : await context.cloudflare.env.DB.prepare(missingReportQuery)
        .bind(...missingReportParams)
        .all();

  // Filter tickets for Co-Admins
  const openTicketsQuery = user.role === "co-admin"
    ? `SELECT t.id, t.title, t.priority, t.status, c.company_name
       FROM support_tickets t
       JOIN clients c ON c.id = t.client_id
       WHERE t.status IN ('open', 'in_progress') AND t.client_id IN (${assignedClientIds.map(() => "?").join(",")})
       ORDER BY t.created_at DESC
       LIMIT 6`
    : `SELECT t.id, t.title, t.priority, t.status, c.company_name
       FROM support_tickets t
       JOIN clients c ON c.id = t.client_id
       WHERE t.status IN ('open', 'in_progress')
       ORDER BY t.created_at DESC
       LIMIT 6`;

  const openTicketsParams = user.role === "co-admin"
    ? [...assignedClientIds]
    : [];

  const openTicketsResult = user.role === "co-admin" && assignedClientIds.length === 0
    ? { results: [] }
    : await context.cloudflare.env.DB.prepare(openTicketsQuery)
        .bind(...openTicketsParams)
        .all();

  const clientsMissingReport = ((missingReportResult as { results?: MissingReportClient[] }).results ?? [])
    .filter((c) => c.company_name !== "บริษัท ดู แอคชั่น จำกัด");
  const urgentTickets = (openTicketsResult as { results?: DashboardTicket[] }).results ?? [];

  return {
    totalClients: clients.length,
    clientsMissingReportCount: clientsMissingReport.length,
    clientsMissingReport,
    openTickets: urgentTickets.length,
    urgentTickets,
    clients: clients.slice(0, 6),
    userRole: user.role,
    currentMonth: month,
    currentYear: year,
  };
}

export default function AdminOverviewPage({ loaderData }: any) {
  const data = loaderData;
  const { t } = useT();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">
          {data.userRole === "co-admin" ? "ภาพรวม Co-Admin" : t("admin_overview_title")}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {data.userRole === "co-admin"
            ? "ข้อมูลสำหรับลูกค้าที่คุณดูแล"
            : t("admin_overview_subtitle")}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <p className="text-sm text-slate-500">{t("admin_stat_total_clients")}</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900">
            {data.totalClients}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <p className="text-sm text-slate-500">{t("admin_stat_open_tickets")}</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900">
            {data.openTickets}
          </p>
        </div>
        <div className={`rounded-xl border p-5 ${data.clientsMissingReportCount > 0 ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-white"}`}>
          <p className="text-sm text-slate-500">{t("admin_stat_reports_due")}</p>
          <p className={`mt-2 text-3xl font-semibold ${data.clientsMissingReportCount > 0 ? "text-amber-600" : "text-slate-900"}`}>
            {data.clientsMissingReportCount}
          </p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">
              {t("admin_section_clients")}
            </h2>
            <Link to="/admin/clients" className="text-xs text-violet-600">
              {t("admin_view_all")}
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
            <h2 className="font-semibold text-slate-900">
              {t("admin_section_quick_reply")}
            </h2>
            <Link to="/admin/tickets" className="text-xs text-violet-600">
              {t("admin_open_tickets_link")}
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
              <p className="text-sm text-slate-400">{t("admin_no_urgent")}</p>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-slate-900">
              {t("admin_section_missing_reports")}
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              {data.currentYear}/{String(data.currentMonth).padStart(2, "0")}
            </p>
          </div>
          {data.userRole === "admin" && (
            <Link to="/admin/reports/new" className="text-xs text-violet-600">
              {t("admin_create_report")}
            </Link>
          )}
        </div>
        {data.clientsMissingReport.length === 0 ? (
          <p className="text-sm text-slate-400">{t("admin_no_missing_reports")}</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {data.clientsMissingReport.map((client: MissingReportClient) => (
              <div
                key={client.id}
                className="flex items-center justify-between rounded-lg border border-amber-100 bg-amber-50 px-3 py-2"
              >
                <span className="text-sm text-slate-700">{client.company_name}</span>
                {data.userRole === "admin" && (
                  <Link
                    to={`/admin/reports/new`}
                    className="ml-2 shrink-0 text-xs font-medium text-amber-700 hover:text-amber-900"
                  >
                    + {t("admin_create_report")}
                  </Link>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
