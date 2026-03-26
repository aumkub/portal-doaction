import { useState } from "react";
import type { Route } from "./+types/reports";
import { requireUser } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";
import { getThaiMonth } from "~/lib/utils";
import type { MonthlyReport, ReportTask } from "~/types";

export function meta() {
  return [{ title: "รายงานประจำเดือน — DoAction Portal" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const user = await requireUser(request, context.cloudflare.env.DB, context.cloudflare.env.SESSIONPORTAL);
  const db = createDB(context.cloudflare.env.DB);
  const client = await db.getClientByUserId(user.id);
  if (!client) return { reports: [], tasks: [], selectedReport: null };

  const reports = await db.listReportsByClient(client.id);
  const publishedReports = reports.filter((r) => r.status === "published");

  // Load tasks for the most recent published report
  const url = new URL(request.url);
  const reportId = url.searchParams.get("report") ?? publishedReports[0]?.id;
  const selectedReport = publishedReports.find((r) => r.id === reportId) ?? null;
  const tasks = selectedReport
    ? await db.listTasksByReport(selectedReport.id)
    : [];

  return { reports: publishedReports, selectedReport, tasks };
}

export default function ReportsPage({ loaderData }: Route.ComponentProps) {
  const { reports, selectedReport, tasks } = loaderData as {
    reports: MonthlyReport[];
    selectedReport: MonthlyReport | null;
    tasks: ReportTask[];
  };

  const categoryLabels: Record<string, string> = {
    maintenance: "Maintenance",
    development: "Development",
    security: "Security",
    seo: "SEO",
    performance: "Performance",
    other: "อื่นๆ",
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">
            รายงานประจำเดือน
          </h1>
          <p className="text-slate-500 text-sm mt-1">
            สรุปงานที่ทีมดำเนินการในแต่ละเดือน
          </p>
        </div>

        {/* Month selector */}
        {reports.length > 0 && (
          <form>
            <select
              name="report"
              defaultValue={selectedReport?.id ?? ""}
              onChange={(e) => {
                const url = new URL(window.location.href);
                url.searchParams.set("report", e.target.value);
                window.location.href = url.toString();
              }}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-900"
            >
              {reports.map((r) => (
                <option key={r.id} value={r.id}>
                  {getThaiMonth(r.month)} {r.year + 543}
                </option>
              ))}
            </select>
          </form>
        )}
      </div>

      {!selectedReport ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <p className="text-slate-400">ยังไม่มีรายงาน</p>
        </div>
      ) : (
        <>
          {/* Summary */}
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-1">
              {selectedReport.title}
            </h2>
            {selectedReport.summary && (
              <p className="text-slate-500 text-sm mb-4">
                {selectedReport.summary}
              </p>
            )}
            <div className="grid grid-cols-3 gap-4 mt-4">
              <div className="text-center p-3 bg-slate-50 rounded-lg">
                <p className="text-xs text-slate-500">งานทั้งหมด</p>
                <p className="text-2xl font-semibold text-slate-900">
                  {selectedReport.total_tasks}
                </p>
              </div>
              <div className="text-center p-3 bg-slate-50 rounded-lg">
                <p className="text-xs text-slate-500">Uptime</p>
                <p className="text-2xl font-semibold text-slate-900">
                  {selectedReport.uptime_percent != null
                    ? `${selectedReport.uptime_percent.toFixed(2)}%`
                    : "—"}
                </p>
              </div>
              <div className="text-center p-3 bg-slate-50 rounded-lg">
                <p className="text-xs text-slate-500">Speed Score</p>
                <p className="text-2xl font-semibold text-slate-900">
                  {selectedReport.speed_score ?? "—"}
                </p>
              </div>
            </div>
          </div>

          {/* Task list */}
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <h2 className="text-sm font-semibold text-slate-900 mb-4">
              📋 งานที่ดำเนินการ ({tasks.length} รายการ)
            </h2>
            {tasks.length === 0 ? (
              <p className="text-slate-400 text-sm">ไม่มีรายการงาน</p>
            ) : (
              <ul className="space-y-3">
                {tasks.map((task) => (
                  <li
                    key={task.id}
                    className="flex items-start gap-3 py-3 border-b border-slate-100 last:border-0"
                  >
                    <span className="text-emerald-500 mt-0.5">✅</span>
                    <div className="flex-1">
                      <p className="text-sm text-slate-700 font-medium">
                        {task.title}
                      </p>
                      {task.description && (
                        <p className="text-xs text-slate-400 mt-0.5">
                          {task.description}
                        </p>
                      )}
                    </div>
                    <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">
                      {categoryLabels[task.category] ?? task.category}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Export */}
          <div className="flex justify-end">
            <button
              type="button"
              className="flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
            >
              📥 Export PDF
            </button>
          </div>
        </>
      )}
    </div>
  );
}
