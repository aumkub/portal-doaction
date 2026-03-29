import { Form } from "react-router";
import type { Route } from "./+types/reports.$reportId";
import { createDB } from "~/lib/db.server";
import { getThaiMonth } from "~/lib/utils";
import { verifyReportAccessToken } from "~/lib/report-access.server";
import { Input } from "~/components/ui/input";
import ReportStats from "~/components/reports/ReportStats";
import TaskList from "~/components/reports/TaskList";
import type { MonthlyReport, ReportTask } from "~/types";

export function meta({ data }: Route.MetaArgs) {
  const report = (data as { report: MonthlyReport } | null)?.report;
  if (!report) return [{ title: "รายงานลูกค้า — do action portal" }];
  return [
    {
      title: `รายงาน ${getThaiMonth(report.month)} ${report.year + 543} — do action portal`,
    },
  ];
}

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const db = createDB(env.DB);
  const report = await db.getReport(params.reportId);
  if (!report || report.status !== "published") {
    throw new Response("Not Found", { status: 404 });
  }

  const client = await db.getClientById(report.client_id);
  if (!client) throw new Response("Not Found", { status: 404 });

  let loginEmail = "";
  const token = new URL(request.url).searchParams.get("t");
  if (token) {
    const secret = env.SESSION_SECRET || "doaction-report-link-secret";
    const payload = await verifyReportAccessToken(token, secret);
    if (payload && payload.reportId === params.reportId) {
      loginEmail = payload.email;
    }
  }

  const tasks = await db.listTasksByReport(report.id);
  const loginRedirect = `/reports/${report.id}`;
  return { report, tasks, loginEmail, loginRedirect };
}

export default function PublicReportPage({ loaderData }: Route.ComponentProps) {
  const { report, tasks, loginEmail, loginRedirect } = loaderData as {
    report: MonthlyReport;
    tasks: ReportTask[];
    loginEmail: string;
    loginRedirect: string;
  };

  const heading = `รายงานประจำเดือน ${getThaiMonth(report.month)} ${report.year + 543}`;

  return (
    <div className="min-h-screen bg-slate-50">
      <main className="mx-auto max-w-4xl px-4 py-8 space-y-6">
        <section className="bg-white rounded-xl border border-slate-200 p-5 sm:p-6 space-y-3">
          <h1 className="text-xl sm:text-2xl font-semibold text-slate-900">{heading}</h1>
          {report.summary && (
            <p className="text-sm text-slate-600 leading-relaxed">{report.summary}</p>
          )}
          <div className="rounded-lg border border-violet-200 bg-violet-50 p-4 space-y-3">
            <p className="text-sm text-violet-900">
              ต้องการเข้าระบบเพื่อดูรายงานทั้งหมดหรือหน้าอื่นในพอร์ทัล?
            </p>
            <Form method="post" action={`/login?redirect=${encodeURIComponent(loginRedirect)}`}>
              <input type="hidden" name="mode" value="magic" />
              <Input
                name="email"
                type="email"
                required
                defaultValue={loginEmail}
                placeholder="you@example.com"
                className="mb-2 h-10 bg-white"
              />
              <button
                type="submit"
                className="inline-flex items-center rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 transition-colors"
              >
                ส่ง Magic Link เพื่อเข้าสู่ระบบ
              </button>
            </Form>
          </div>
        </section>

        <ReportStats report={report} />

        <section className="bg-white rounded-xl border border-slate-200 p-6">
          <h2 className="text-sm font-semibold text-slate-900 mb-5">
            งานที่ดำเนินการ ({tasks.length} รายการ)
          </h2>
          <TaskList tasks={tasks} />
        </section>
      </main>
    </div>
  );
}
