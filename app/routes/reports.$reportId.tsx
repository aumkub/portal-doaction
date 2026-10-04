import { Form } from "react-router";
import { getReportLinkSecret } from "~/lib/secrets.server";
import type { Route } from "./+types/reports.$reportId";
import { createDB } from "~/lib/db.server";
import { getThaiMonth } from "~/lib/utils";
import { verifyReportAccessToken } from "~/lib/report-access.server";
import { getAuthenticatedUser } from "~/lib/auth.server";
import { Input } from "~/components/ui/input";
import type { MonthlyReport, ReportTask, TaskCategory } from "~/types";
import { FaCircleCheck, FaWrench, FaCode, FaLock, FaChartLine, FaBolt, FaTag, FaArrowLeft, FaPrint } from "react-icons/fa6";

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
    const secret = getReportLinkSecret(env);
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

const CATEGORIES: Record<TaskCategory, { label: string; icon: React.ReactNode }> = {
  maintenance: { label: "บำรุงรักษา", icon: <FaWrench /> },
  development: { label: "พัฒนา", icon: <FaCode /> },
  security: { label: "ความปลอดภัย", icon: <FaLock /> },
  seo: { label: "SEO", icon: <FaChartLine /> },
  performance: { label: "ประสิทธิภาพ", icon: <FaBolt /> },
  other: { label: "อื่นๆ", icon: <FaTag /> },
};

const backLinkCls =
  "inline-flex items-center gap-2 h-10 rounded-full border border-line bg-white px-4 text-[13px] font-semibold text-ink hover:bg-paper transition-colors";

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

  const monthLabel = `${getThaiMonth(report.month)} ${report.year + 543}`;
  const completedCount = tasks.filter((t) => t.completed).length;
  const grouped = tasks.reduce<Partial<Record<TaskCategory, ReportTask[]>>>((acc, task) => {
    (acc[task.category] ??= []).push(task);
    return acc;
  }, {});
  const categories = (Object.keys(CATEGORIES) as TaskCategory[]).filter((c) => grouped[c]?.length);

  const stats: { label: string; value: string }[] = [
    { label: "งานที่ดำเนินการ", value: String(tasks.length) },
    ...(report.uptime_percent != null ? [{ label: "Uptime", value: `${report.uptime_percent}%` }] : []),
    ...(report.speed_score != null ? [{ label: "Speed score", value: String(report.speed_score) }] : []),
    { label: "หมวดงาน", value: String(categories.length) },
  ];

  return (
    <div className="min-h-screen bg-paper text-ink print:bg-white">
      <main className="mx-auto max-w-4xl space-y-5 px-4 py-6 md:py-10 print:max-w-none print:px-0 print:py-0">
        {/* Top bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
          <img src="/logo-dark-tight.svg" alt="do action" className="h-12 w-auto" />
          <div className="flex flex-wrap items-center gap-2">
            {isAdminPreview ? (
              <a href="/admin/reports" className={backLinkCls}>
                <FaArrowLeft className="text-[11px]" aria-hidden="true" />
                กลับไปหน้ารายงาน (Admin)
              </a>
            ) : canGoToReportList ? (
              <a href="/reports" className={backLinkCls}>
                <FaArrowLeft className="text-[11px]" aria-hidden="true" />
                ไปหน้ารายงานทั้งหมด
              </a>
            ) : null}
            <button type="button" onClick={() => window.print()} className={backLinkCls}>
              <FaPrint className="text-[11px]" aria-hidden="true" />
              Print / PDF
            </button>
          </div>
        </div>
        <img src="/logo-dark-tight.svg" alt="do action" className="hidden h-12 w-auto print:block" />

        {/* Hero */}
        <section className="rounded-[24px] bg-ink p-7 text-white md:p-10 print:break-inside-avoid print:border print:border-line print:bg-white print:text-ink">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-brand-yellow px-2.5 py-0.5 text-xs font-semibold text-ink">
              Monthly Service Report
            </span>
            {websiteUrl && (
              <a
                href={websiteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-full border border-white/20 px-2.5 py-0.5 text-xs font-medium text-white/80 hover:text-white print:border-line print:text-muted-ink"
              >
                {websiteUrl.replace(/^https?:\/\//, "")}
              </a>
            )}
          </div>
          <p className="mt-6 text-sm text-white/60 print:text-muted-ink">รายงานประจำเดือน</p>
          <h1 className="font-display text-[40px] font-bold leading-none tracking-[-0.03em] md:text-[56px]">
            {monthLabel}
          </h1>
          {report.summary && (
            <p className="mt-5 max-w-2xl whitespace-pre-line text-[15px] leading-relaxed text-white/80 print:text-ink-soft">
              {report.summary}
            </p>
          )}
          <div className="mt-8 grid grid-cols-2 gap-x-6 gap-y-5 border-t border-white/10 pt-6 sm:grid-cols-4 print:border-line">
            {stats.map((s) => (
              <div key={s.label}>
                <p className="font-display text-[34px] font-bold leading-none tracking-[-0.03em] tabular-nums text-brand-yellow print:text-ink">
                  {s.value}
                </p>
                <p className="mt-1.5 text-xs text-white/60 print:text-muted-ink">{s.label}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Tasks by category */}
        <section className="rounded-[20px] border border-line bg-white p-6 md:p-8">
          <div className="mb-6 flex items-baseline justify-between gap-3">
            <h2 className="text-[18px] font-semibold">งานที่ดำเนินการ</h2>
            <span className="text-[13px] text-muted-ink">
              {completedCount}/{tasks.length} รายการ
            </span>
          </div>
          {categories.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-ink">ไม่มีรายการงาน</p>
          ) : (
            <div className="space-y-8">
              {categories.map((cat) => {
                const items = grouped[cat] ?? [];
                return (
                  <div key={cat} className="print:break-inside-avoid">
                    <div className="mb-3 flex items-center gap-2.5">
                      <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-paper text-xs text-ink" aria-hidden="true">
                        {CATEGORIES[cat].icon}
                      </span>
                      <h3 className="text-[15px] font-semibold">{CATEGORIES[cat].label}</h3>
                      <span className="ml-auto rounded-full bg-paper px-2.5 py-0.5 text-xs font-semibold text-muted-ink">
                        {items.length}
                      </span>
                    </div>
                    <ul className="divide-y divide-line-soft border-t border-line-soft">
                      {items.map((task) => (
                        <li key={task.id} className="flex items-start gap-3 py-3.5">
                          <FaCircleCheck
                            className={`mt-0.5 shrink-0 text-sm ${task.completed ? "text-ink" : "text-line"}`}
                            aria-hidden="true"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-ink">{task.title}</p>
                            {task.description && (
                              <p className="mt-1 whitespace-pre-line text-[13px] leading-relaxed text-muted-ink">
                                {task.description}
                              </p>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {!canGoToReportList && !isAdminPreview && (
          <section className="rounded-[24px] bg-brand-yellow p-6 text-ink md:p-7 print:hidden">
            <h2 className="text-[18px] font-semibold">ดูรายงานทั้งหมดในพอร์ทัล</h2>
            <p className="mt-1 text-sm text-ink-soft">
              เข้าสู่ระบบ เพื่อดูรายงานทั้งหมดหรือหน้าอื่นในพอร์ทัล
            </p>
            <Form
              method="post"
              action={`/login?redirect=${encodeURIComponent(loginRedirect)}`}
              className="mt-4 flex flex-col gap-2 sm:flex-row"
            >
              <input type="hidden" name="mode" value="magic" />
              <Input
                name="email"
                type="email"
                required
                defaultValue={loginEmail}
                placeholder="you@example.com"
                className="h-10 flex-1 !bg-white"
              />
              <button
                type="submit"
                className="inline-flex h-10 shrink-0 items-center justify-center rounded-full bg-ink px-5 text-[13px] font-semibold text-white hover:bg-black transition-colors"
              >
                ส่ง Magic Link เพื่อเข้าสู่ระบบ
              </button>
            </Form>
          </section>
        )}

        <p className="pb-4 text-center text-xs text-faint-ink">do action client portal</p>
      </main>
    </div>
  );
}
