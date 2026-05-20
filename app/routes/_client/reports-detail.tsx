import { Printer } from "lucide-react";
import type { Route } from "./+types/reports-detail";
import { requireUser } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";
import { getThaiMonth } from "~/lib/utils";
import { useT } from "~/lib/i18n";
import ReportStats from "~/components/reports/ReportStats";
import TaskList from "~/components/reports/TaskList";
import type { MonthlyReport, ReportTask } from "~/types";
import { FaFileLines } from "react-icons/fa6";

export function meta({ data }: Route.MetaArgs) {
  const report = (data as { report: MonthlyReport } | null)?.report;
  if (!report) return [{ title: "Report — do action portal" }];
  return [{ title: `รายงาน ${getThaiMonth(report.month)} ${report.year + 543} — do action portal` }];
}

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const user = await requireUser(request, env.DB, env.SESSIONPORTAL);
  const db = createDB(env.DB);

  const report = await db.getReport(params.reportId);
  if (!report) throw new Response("Not Found", { status: 404 });

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
  const { lang } = useT();
  const yearDisplay = (year: number) => (lang === "th" ? year + 543 : year);
  const heading = `รายงานประจำเดือน ${getThaiMonth(report.month)} ${yearDisplay(report.year)}`;

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Back + heading bar */}
      <div>
        <a
          href="/reports"
          className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 transition-colors mb-4"
        >
          ← รายงานทั้งหมด
        </a>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">{heading}</h1>
            {report.summary && (
              <p className="mt-1 text-sm text-slate-500">{report.summary}</p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {/* Month switcher */}
            {published.length > 1 && (
              <select
                defaultValue={report.id}
                onChange={(e) => { window.location.href = `/reports/${e.target.value}`; }}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet-400 focus:border-violet-400 transition"
              >
                {published.map((r) => (
                  <option key={r.id} value={r.id}>
                    {getThaiMonth(r.month)} {yearDisplay(r.year)}
                  </option>
                ))}
              </select>
            )}
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors print:hidden"
            >
              <Printer className="w-4 h-4" />
              ส่งออก PDF
            </button>
          </div>
        </div>
      </div>

      {/* Summary stats */}
      <ReportStats report={report} />

      {/* Task list */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
          <FaFileLines className="text-slate-500 text-sm" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-slate-900">
            งานที่ดำเนินการ
            <span className="ml-1.5 text-xs font-normal text-slate-500">({tasks.length} รายการ)</span>
          </h2>
        </div>
        <div className="p-5">
          <TaskList tasks={tasks} />
        </div>
      </div>

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
