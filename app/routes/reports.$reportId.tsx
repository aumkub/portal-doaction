import { Form } from "react-router";
import type { Route } from "./+types/reports.$reportId";
import { createDB } from "~/lib/db.server";
import { getThaiMonth } from "~/lib/utils";
import { verifyReportAccessToken } from "~/lib/report-access.server";
import { getAuthenticatedUser } from "~/lib/auth.server";
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
  const viewer = await getAuthenticatedUser(request, env.DB, env.SESSIONPORTAL);
  const isAdminPreview = viewer?.role === "admin";
  if (!report || (report.status !== "published" && !isAdminPreview)) {
    throw new Response("Not Found", { status: 404 });
  }

  const client = await db.getClientById(report.client_id);
  if (!client) throw new Response("Not Found", { status: 404 });

  let canGoToReportList = false;
  if (viewer?.role === "client") {
    const viewerClient = await db.getClientByUserId(viewer.id);
    canGoToReportList = Boolean(viewerClient && viewerClient.id === report.client_id);
  }

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
  return {
    report,
    tasks,
    loginEmail,
    loginRedirect,
    canGoToReportList,
    isAdminPreview,
    websiteUrl: client.website_url,
  };
}

export default function PublicReportPage({ loaderData }: Route.ComponentProps) {
  const { report, tasks, loginEmail, loginRedirect, canGoToReportList, isAdminPreview, websiteUrl } = loaderData as {
    report: MonthlyReport;
    tasks: ReportTask[];
    loginEmail: string;
    loginRedirect: string;
    canGoToReportList: boolean;
    isAdminPreview: boolean;
    websiteUrl: string | null;
  };

  const heading = `รายงานประจำเดือน ${getThaiMonth(report.month)} ${report.year + 543}`;
  const brandLogo = (
    <div>
      <div className="flex items-center gap-3 mb-1">
        <img src="/logo-dark.svg" alt="do action" className="w-[150px] mx-auto"/>
      </div>
      <p className="block text-center text-[10px] text-black mt-1 tracking-widest font-bold">
        CLIENT PORTAL
      </p>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50">
      <main className="mx-auto max-w-4xl px-4 py-4 space-y-6">
        <div className="print:hidden">
          {isAdminPreview ? (
            <div className="pb-1 flex items-center justify-between gap-3 no-print">
              <a
                href="/admin/reports"
                className="inline-flex items-center rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 transition-colors shadow-sm"
              >
                <span className="mr-2 text-slate-500" aria-hidden="true">←</span>
                กลับไปหน้ารายงาน (Admin)
              </a>
              <div>{brandLogo}</div>
            </div>
          ) : canGoToReportList ? (
            <div className="pb-1 flex flex-col sm:flex-row items-center justify-between gap-3 no-print">
              <a
                href="/reports"
                className="order-2 sm:order-1 inline-flex items-center rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 transition-colors shadow-sm"
              >
                <span className="mr-2 text-slate-500" aria-hidden="true">←</span>
                ไปหน้ารายงานทั้งหมด
              </a>
              <div className="order-1 sm:order-2">{brandLogo}</div>
            </div>
          ) : (
            <div className="no-print">{brandLogo}</div>
          )}
        </div>
        <section className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 space-y-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
              Monthly Service Report
            </div>
            {websiteUrl && (
              <a
                href={websiteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex w-fit items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200 transition-colors"
              >
                {websiteUrl.replace(/^https?:\/\//, "")}
              </a>
            )}
          </div>
          <h1 className="text-xl sm:text-2xl font-semibold text-slate-900">{heading}</h1>

          {report.summary && (
            <p className="text-sm text-slate-600 leading-relaxed">{report.summary}</p>
          )}
          {!canGoToReportList && !isAdminPreview && (
            <div className="rounded-xl border border-violet-200 bg-violet-50/80 p-4 space-y-3">
              <p className="text-sm text-violet-900">
                เข้าสู่ระบบ เพื่อดูรายงานทั้งหมดหรือหน้าอื่นในพอร์ทัล
              </p>
              <Form method="post" action={`/login?redirect=${encodeURIComponent(loginRedirect)}`}>
                <input type="hidden" name="mode" value="magic" />
                <Input
                  name="email"
                  type="email"
                  required
                  defaultValue={loginEmail}
                  placeholder="you@example.com"
                  className="mb-2 h-10 !bg-white"
                />
                <button
                  type="submit"
                  className="inline-flex items-center rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 transition-colors mt-2 shadow-sm"
                >
                  ส่ง Magic Link เพื่อเข้าสู่ระบบ
                </button>
              </Form>
            </div>
          )}
        </section>

        <ReportStats report={report} />

        <section className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900 mb-5">
            งานที่ดำเนินการ ({tasks.length} รายการ)
          </h2>
          <TaskList tasks={tasks} />
        </section>
      </main>
    </div>
  );
}
