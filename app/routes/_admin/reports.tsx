import type { Route } from "./+types/reports";
import { requireAdmin } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";
import { getThaiMonth } from "~/lib/utils";
import type { MonthlyReport, Client } from "~/types";

export function meta() {
  return [{ title: "จัดการ Report — Admin" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  await requireAdmin(request, context.cloudflare.env.DB, context.cloudflare.env.SESSION_KV);
  const db = createDB(context.cloudflare.env.DB);
  const clients = await db.listClients();

  // Load recent reports across all clients
  const allReports: (MonthlyReport & { company_name: string })[] = [];
  for (const client of clients) {
    const reports = await db.listReportsByClient(client.id);
    for (const r of reports.slice(0, 3)) {
      allReports.push({ ...r, company_name: client.company_name });
    }
  }
  allReports.sort((a, b) => b.created_at - a.created_at);

  return { reports: allReports.slice(0, 20), clients };
}

const statusStyle = {
  draft: "bg-slate-100 text-slate-500",
  published: "bg-emerald-50 text-emerald-600",
};

export default function AdminReportsPage({ loaderData }: Route.ComponentProps) {
  const { reports, clients } = loaderData as {
    reports: (MonthlyReport & { company_name: string })[];
    clients: Client[];
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">
            จัดการ Reports
          </h1>
          <p className="text-slate-500 text-sm mt-1">
            สร้างและจัดการรายงานประจำเดือน
          </p>
        </div>
        <a
          href="/admin/reports/new"
          className="flex items-center gap-2 bg-[#F0D800] text-slate-900 rounded-lg px-4 py-2 text-sm font-medium hover:bg-yellow-400 transition-colors"
        >
          + สร้าง Report ใหม่
        </a>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="text-left text-xs font-medium text-slate-500 px-5 py-3">
                ลูกค้า
              </th>
              <th className="text-left text-xs font-medium text-slate-500 px-5 py-3">
                เดือน
              </th>
              <th className="text-left text-xs font-medium text-slate-500 px-5 py-3">
                งาน
              </th>
              <th className="text-left text-xs font-medium text-slate-500 px-5 py-3">
                สถานะ
              </th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody>
            {reports.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-5 py-12 text-center text-slate-400"
                >
                  ยังไม่มี Report
                </td>
              </tr>
            ) : (
              reports.map((report) => (
                <tr
                  key={report.id}
                  className="border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors"
                >
                  <td className="px-5 py-4 font-medium text-slate-900">
                    {report.company_name}
                  </td>
                  <td className="px-5 py-4 text-slate-600">
                    {getThaiMonth(report.month)} {report.year + 543}
                  </td>
                  <td className="px-5 py-4 text-slate-500">
                    {report.total_tasks} รายการ
                  </td>
                  <td className="px-5 py-4">
                    <span
                      className={`text-xs font-medium px-2 py-1 rounded-full ${statusStyle[report.status]}`}
                    >
                      {report.status === "published" ? "เผยแพร่แล้ว" : "Draft"}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-right">
                    <a
                      href={`/admin/reports/${report.id}`}
                      className="text-xs text-slate-500 hover:text-slate-900 transition-colors"
                    >
                      แก้ไข →
                    </a>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
