import { requireCoAdminOrAdmin } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";
import { useT } from "~/lib/i18n";
import {
  FaUsers, FaTicket, FaFileLines,
  FaCircle, FaArrowRight,
} from "react-icons/fa6";

type DashboardTicket = {
  id: string;
  title: string;
  priority: string;
  status: string;
  company_name: string;
  client_id: string;
};

type DashboardClient = {
  id: string;
  company_name: string;
  package: "basic" | "standard" | "premium";
};

export function meta() {
  return [{ title: "Admin Overview — do action portal" }];
}

export async function loader({ request, context }: any) {
  const user = await requireCoAdminOrAdmin(
    request,
    context.cloudflare.env.DB,
    context.cloudflare.env.SESSIONPORTAL
  );
  const db = createDB(context.cloudflare.env.DB);
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  let assignedClientIds: string[] = [];
  if (user.role === "co-admin") {
    const assignments = await db.listCoAdminClients(user.id);
    assignedClientIds = assignments.map((a) => a.client_id);
  }

  const allClients = await db.listClients();
  const clients =
    user.role === "co-admin"
      ? allClients.filter((c) => assignedClientIds.includes(c.id))
      : allClients;

  const dueReportsQuery =
    user.role === "co-admin"
      ? `SELECT COUNT(*) as count FROM monthly_reports WHERE year = ? AND month = ? AND client_id IN (${assignedClientIds.map(() => "?").join(",")})`
      : "SELECT COUNT(*) as count FROM monthly_reports WHERE year = ? AND month = ?";
  const dueReportsParams =
    user.role === "co-admin" ? [year, month, ...assignedClientIds] : [year, month];
  const dueReports = await context.cloudflare.env.DB.prepare(dueReportsQuery)
    .bind(...dueReportsParams)
    .first();

  const openTicketsQuery =
    user.role === "co-admin"
      ? `SELECT t.id, t.title, t.priority, t.status, c.company_name, c.id as client_id
         FROM support_tickets t JOIN clients c ON c.id = t.client_id
         WHERE t.status IN ('open', 'in_progress') AND t.client_id IN (${assignedClientIds.map(() => "?").join(",")})
         ORDER BY t.created_at DESC LIMIT 6`
      : `SELECT t.id, t.title, t.priority, t.status, c.company_name, c.id as client_id
         FROM support_tickets t JOIN clients c ON c.id = t.client_id
         WHERE t.status IN ('open', 'in_progress')
         ORDER BY t.created_at DESC LIMIT 6`;
  const openTicketsParams = user.role === "co-admin" ? [...assignedClientIds] : [];
  const openTicketsResult = await context.cloudflare.env.DB.prepare(openTicketsQuery)
    .bind(...openTicketsParams)
    .all();

  const urgentTickets: DashboardTicket[] =
    (openTicketsResult as { results?: DashboardTicket[] }).results ?? [];

  return {
    totalClients: clients.length,
    reportsDueThisMonth: (dueReports as { count?: number } | null)?.count ?? 0,
    openTickets: urgentTickets.length,
    urgentTickets,
    clients: clients.slice(0, 6) as DashboardClient[],
    userRole: user.role,
  };
}

const packageStyles = {
  basic:    "bg-slate-100 text-slate-600 ring-1 ring-slate-200",
  standard: "bg-blue-50 text-blue-600 ring-1 ring-blue-200",
  premium:  "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
} as const;

const priorityDot = {
  urgent:  "bg-red-500",
  high:    "bg-orange-400",
  medium:  "bg-amber-400",
  low:     "bg-slate-300",
} as const;

const statusStyles: Record<string, string> = {
  open:        "bg-blue-50 text-blue-700 ring-1 ring-blue-200",
  in_progress: "bg-violet-50 text-violet-700 ring-1 ring-violet-200",
  waiting:     "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
  resolved:    "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
  closed:      "bg-slate-100 text-slate-600 ring-1 ring-slate-200",
};

function getInitials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

function avatarColor(name: string) {
  const colors = [
    "bg-violet-100 text-violet-700",
    "bg-blue-100 text-blue-700",
    "bg-emerald-100 text-emerald-700",
    "bg-orange-100 text-orange-700",
    "bg-rose-100 text-rose-700",
    "bg-indigo-100 text-indigo-700",
    "bg-teal-100 text-teal-700",
    "bg-pink-100 text-pink-700",
  ];
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) & 0xffff;
  return colors[hash % colors.length];
}

export default function AdminOverviewPage({ loaderData }: any) {
  const data = loaderData;
  const { t } = useT();
  const isCoAdmin = data.userRole === "co-admin";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">
          {isCoAdmin ? "ภาพรวม Co-Admin" : t("admin_overview_title")}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {isCoAdmin ? "ข้อมูลสำหรับลูกค้าที่คุณดูแล" : t("admin_overview_subtitle")}
        </p>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-xl border border-slate-200 bg-white px-5 py-4 flex items-center gap-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 text-violet-600 shrink-0">
            <FaUsers className="text-base" />
          </span>
          <div>
            <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">{t("admin_stat_total_clients")}</p>
            <p className="text-2xl font-semibold text-slate-900 leading-tight">{data.totalClients}</p>
          </div>
        </div>
        <div className="rounded-xl border border-blue-100 bg-blue-50 px-5 py-4 flex items-center gap-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 text-blue-600 shrink-0">
            <FaTicket className="text-base" />
          </span>
          <div>
            <p className="text-[11px] font-medium text-blue-600 uppercase tracking-wide">{t("admin_stat_open_tickets")}</p>
            <p className="text-2xl font-semibold text-blue-700 leading-tight">{data.openTickets}</p>
          </div>
        </div>
        <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-5 py-4 flex items-center gap-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600 shrink-0">
            <FaFileLines className="text-base" />
          </span>
          <div>
            <p className="text-[11px] font-medium text-emerald-600 uppercase tracking-wide">{t("admin_stat_reports_due")}</p>
            <p className="text-2xl font-semibold text-emerald-700 leading-tight">{data.reportsDueThisMonth}</p>
          </div>
        </div>
      </div>

      {/* Main grid */}
      <div className="grid gap-5 lg:grid-cols-2">
        {/* Clients */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
            <h2 className="text-sm font-semibold text-slate-900">{t("admin_section_clients")}</h2>
            <a href="/admin/clients" className="inline-flex items-center gap-1 text-xs font-medium text-violet-600 hover:text-violet-700 transition-colors">
              {t("admin_view_all")} <FaArrowRight className="text-[9px]" />
            </a>
          </div>
          <div className="divide-y divide-slate-50">
            {data.clients.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-slate-500">{t("admin_clients_empty")}</p>
            ) : (
              data.clients.map((client: DashboardClient) => (
                <a
                  key={client.id}
                  href={`/admin/clients/${client.id}`}
                  className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50 transition-colors group"
                >
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${avatarColor(client.company_name)}`}>
                    {getInitials(client.company_name)}
                  </span>
                  <span className="flex-1 min-w-0 text-sm font-medium text-slate-800 truncate group-hover:text-slate-900">
                    {client.company_name}
                  </span>
                  <span className={`shrink-0 text-[11px] font-medium px-2 py-0.5 rounded-full capitalize ${packageStyles[client.package]}`}>
                    {client.package}
                  </span>
                </a>
              ))
            )}
          </div>
        </div>

        {/* Open Tickets */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
            <h2 className="text-sm font-semibold text-slate-900">{t("admin_section_quick_reply")}</h2>
            <a href="/admin/tickets" className="inline-flex items-center gap-1 text-xs font-medium text-violet-600 hover:text-violet-700 transition-colors">
              {t("admin_open_tickets_link")} <FaArrowRight className="text-[9px]" />
            </a>
          </div>
          <div className="divide-y divide-slate-50">
            {data.urgentTickets.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-slate-500">{t("admin_no_urgent")}</p>
            ) : (
              data.urgentTickets.map((ticket: DashboardTicket) => (
                <a
                  key={ticket.id}
                  href={`/admin/tickets/${ticket.id}`}
                  className="flex items-start gap-3 px-5 py-3 hover:bg-slate-50 transition-colors group"
                >
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${priorityDot[ticket.priority as keyof typeof priorityDot] ?? "bg-slate-300"}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-800 truncate group-hover:text-slate-900 leading-snug">
                      {ticket.title}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">{ticket.company_name}</p>
                  </div>
                  <span className={`shrink-0 text-[11px] font-medium px-2 py-0.5 rounded-full ${statusStyles[ticket.status] ?? ""}`}>
                    {ticket.status.replace("_", " ")}
                  </span>
                </a>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
