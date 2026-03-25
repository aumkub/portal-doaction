import { Printer } from "lucide-react";
import type { Route } from "./+types/reports-detail";
import { requireUser } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";
import { getThaiMonth } from "~/lib/utils";
import PageHeader from "~/components/layout/PageHeader";
import ReportStats from "~/components/reports/ReportStats";
import TaskList from "~/components/reports/TaskList";
import type { MonthlyReport, ReportTask } from "~/types";

export function meta({ data }: Route.MetaArgs) {
  const report = (data as { report: MonthlyReport } | null)?.report;
  if (!report) return [{ title: "Report — DoAction Portal" }];
  return [
    {
      title: `รายงาน ${getThaiMonth(report.month)} ${report.year + 543} — DoAction Portal`,
    },
  ];
}

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const user = await requireUser(request, env.DB, env.SESSION_KV);
  const db = createDB(env.DB);

  const report = await db.getReport(params.reportId);
  if (!report) throw new Response("Not Found", { status: 404 });

  // Verify client owns this report
  const client = await db.getClientByUserId(user.id);
  if (!client || report.client_id !== client.id) {
    throw new Response("Forbidden", { status: 403 });
  }

  const tasks = await db.listTasksByReport(report.id);
  const allReports = await db.listReportsByClient(client.id);
  const published = allReports.filter((r) => r.status === "published");

  return { report, tasks, published };
}

export default function ReportDetailPage({ loaderData }: Route.ComponentProps) {
  const { report, tasks, published } = loaderData as {
    report: MonthlyReport;
    tasks: ReportTask[];
    published: MonthlyReport[];
  };

  const heading = `รายงานประจำเดือน ${getThaiMonth(report.month)} ${report.year + 543}`;

  return (
    <div className="space-y-6 max-w-4xl">
      <PageHeader
        title={heading}
        subtitle={report.summary ?? undefined}
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Reports", href: "/reports" },
          { label: `${getThaiMonth(report.month)} ${report.year + 543}` },
        ]}
        actions={
          <div className="flex items-center gap-2">
            {/* Month switcher */}
            {published.length > 1 && (
              <select
                defaultValue={report.id}
                onChange={(e) => {
                  window.location.href = `/reports/${e.target.value}`;
                }}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-900"
              >
                {published.map((r) => (
                  <option key={r.id} value={r.id}>
                    {getThaiMonth(r.month)} {r.year + 543}
                  </option>
                ))}
              </select>
            )}

            {/* Print / Export */}
            <button
              type="button"
              onClick={() => window.print()}
              className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors print:hidden"
            >
              <Printer className="w-4 h-4" />
              Export PDF
            </button>
          </div>
        }
      />

      {/* Summary stats */}
      <ReportStats report={report} />

      {/* Task list */}
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <h2 className="text-sm font-semibold text-slate-900 mb-5">
          📋 งานที่ดำเนินการ ({tasks.length} รายการ)
        </h2>
        <TaskList tasks={tasks} />
      </div>

      {/* Print-only styles */}
      <style>{`
        @media print {
          header, aside, nav, .print\\:hidden { display: none !important; }
          main { padding: 0 !important; }
          body { background: white !important; }
        }
      `}</style>
    </div>
  );
}
