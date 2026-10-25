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
    companyName: client.company_name,
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

type SiteUpdate = { id: string; kind: string; name: string; from: string; to: string; host: string };

/** Update tasks are written by the site-care agent as "อัปเดต<kind> <name> <from> → <to>" with the host as description. */
function parseUpdate(task: ReportTask): SiteUpdate | null {
  const m = task.title.match(/^อัปเดต\s*(ปลั๊กอิน|ธีม|WordPress core|WordPress)\s*(.*?)\s+(\S+)\s+→\s+(\S+)$/);
  if (!m) return null;
  const kind = m[1].startsWith("WordPress") ? "แกนหลัก" : m[1];
  const name = m[1].startsWith("WordPress") ? "WordPress" : m[2].trim() || m[1];
  return { id: task.id, kind, name, from: m[3], to: m[4], host: (task.description ?? "").trim() || "เว็บไซต์" };
}

const PRINT_CSS = `
@page { size: A4; margin: 14mm 13mm 16mm; }
@page { @bottom-right { content: "หน้า " counter(page) " / " counter(pages); font: 9px "Anuphan", sans-serif; color: #8a887f; } }
@media print {
  html, body { background: #fff !important; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .rp-avoid { break-inside: avoid; }
  .rp-keep { break-after: avoid; }
  .rp-table thead { display: table-header-group; }
  .rp-table tr { break-inside: avoid; }
}`;

export default function PublicReportPage({ loaderData }: Route.ComponentProps) {
  const { report, tasks, loginEmail, loginRedirect, canGoToReportList, isAdminPreview, websiteUrl, companyName } = loaderData as {
    report: MonthlyReport;
    tasks: ReportTask[];
    loginEmail: string;
    loginRedirect: string;
    canGoToReportList: boolean;
    isAdminPreview: boolean;
    websiteUrl: string | null;
    companyName: string;
  };

  const monthLabel = `${getThaiMonth(report.month)} ${report.year + 543}`;
  const updates = tasks.map(parseUpdate).filter((u): u is SiteUpdate => u !== null);
  const updateIds = new Set(updates.map((u) => u.id));
  const otherTasks = tasks.filter((t) => !updateIds.has(t.id));
  const grouped = otherTasks.reduce<Partial<Record<TaskCategory, ReportTask[]>>>((acc, task) => {
    (acc[task.category] ??= []).push(task);
    return acc;
  }, {});
  const categories = (Object.keys(CATEGORIES) as TaskCategory[]).filter((c) => grouped[c]?.length);
  const bySite = updates.reduce<Map<string, SiteUpdate[]>>((m, u) => m.set(u.host, [...(m.get(u.host) ?? []), u]), new Map());

  const stats: { label: string; value: string }[] = [
    { label: "งานทั้งหมด", value: String(tasks.length) },
    ...(updates.length ? [{ label: "อัปเดตเว็บไซต์", value: String(updates.length) }] : []),
    ...(report.uptime_percent != null ? [{ label: "Uptime", value: `${report.uptime_percent}%` }] : []),
    ...(report.speed_score != null ? [{ label: "Speed score", value: String(report.speed_score) }] : []),
  ];

  return (
    <div className="min-h-screen bg-paper text-ink print:min-h-0 print:bg-white">
      <style>{PRINT_CSS}</style>
      <main className="mx-auto max-w-4xl space-y-5 px-4 py-6 md:py-10 print:max-w-none print:space-y-4 print:px-0 print:py-0">
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

        {/* Print header: logo left, client and month right, on the first page */}
        <div className="hidden items-end justify-between border-b-2 border-ink pb-3 print:flex">
          <img src="/logo-dark-tight.svg" alt="do action" className="h-9 w-auto" />
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-[0.14em] text-muted-ink">Monthly Service Report</p>
            <p className="text-[13px] font-semibold">{companyName}</p>
          </div>
        </div>

        {/* Hero */}
        <section className="rp-avoid rounded-[24px] bg-ink p-7 text-white md:p-10 print:rounded-none print:bg-transparent print:p-0 print:text-ink">
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <span className="rounded-full bg-brand-yellow px-2.5 py-0.5 text-xs font-semibold text-ink">Monthly Service Report</span>
            <span className="rounded-full border border-white/20 px-2.5 py-0.5 text-xs font-medium text-white/80">{companyName}</span>
          </div>
          <p className="mt-6 text-sm text-white/60 print:mt-1 print:text-[11px] print:text-muted-ink">รายงานประจำเดือน</p>
          <h1 className="font-display text-[40px] font-bold leading-none tracking-[-0.03em] md:text-[56px] print:text-[30px]">{monthLabel}</h1>
          {websiteUrl && (
            <a href={websiteUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-[13px] text-white/70 hover:text-white print:text-[11px] print:text-muted-ink">
              {websiteUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}
            </a>
          )}
          {report.summary && (
            <p className="mt-5 max-w-2xl whitespace-pre-line text-[15px] leading-relaxed text-white/80 print:mt-3 print:max-w-none print:text-[11.5px] print:text-ink-soft">
              {report.summary}
            </p>
          )}
          <div className={`mt-8 grid grid-cols-2 gap-x-6 gap-y-5 border-t border-white/10 pt-6 print:mt-4 print:gap-3 print:border-0 print:pt-0 ${stats.length >= 4 ? "sm:grid-cols-4 print:grid-cols-4" : "sm:grid-cols-3 print:grid-cols-3"}`}>
            {stats.map((s) => (
              <div key={s.label} className="print:rounded-[10px] print:border print:border-line print:px-3 print:py-2">
                <p className="font-display text-[34px] font-bold leading-none tracking-[-0.03em] tabular-nums text-brand-yellow print:text-[22px] print:text-ink">{s.value}</p>
                <p className="mt-1.5 text-xs text-white/60 print:mt-1 print:text-[10px] print:text-muted-ink">{s.label}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Work by category */}
        {categories.length > 0 && (
          <section className="rounded-[20px] border border-line bg-white p-6 md:p-8 print:rounded-none print:border-0 print:p-0">
            <h2 className="rp-keep mb-5 text-[18px] font-semibold print:mb-3 print:border-b print:border-line print:pb-1.5 print:text-[14px]">งานที่ดำเนินการ</h2>
            <div className="space-y-7 print:space-y-4">
              {categories.map((cat) => {
                const items = grouped[cat] ?? [];
                return (
                  <div key={cat}>
                    <div className="rp-keep mb-2 flex items-center gap-2.5">
                      <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-paper text-xs text-ink print:h-6 print:w-6 print:rounded-[7px] print:text-[10px]" aria-hidden="true">
                        {CATEGORIES[cat].icon}
                      </span>
                      <h3 className="text-[15px] font-semibold print:text-[12.5px]">{CATEGORIES[cat].label}</h3>
                      <span className="ml-auto rounded-full bg-paper px-2.5 py-0.5 text-xs font-semibold text-muted-ink print:text-[10px]">{items.length}</span>
                    </div>
                    <ul className="divide-y divide-line-soft border-t border-line-soft">
                      {items.map((task) => (
                        <li key={task.id} className="rp-avoid flex items-start gap-3 py-3 print:gap-2 print:py-1.5">
                          <FaCircleCheck className={`mt-0.5 shrink-0 text-sm print:text-[10px] ${task.completed ? "text-ink" : "text-line"}`} aria-hidden="true" />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-ink print:text-[11.5px]">{task.title}</p>
                            {task.description && (
                              <p className="mt-0.5 whitespace-pre-line text-[13px] leading-relaxed text-muted-ink print:text-[10.5px]">{task.description}</p>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Website updates: one compact table per site */}
        {updates.length > 0 && (
          <section className="rounded-[20px] border border-line bg-white p-6 md:p-8 print:rounded-none print:border-0 print:p-0">
            <div className="rp-keep mb-5 flex items-baseline justify-between gap-3 print:mb-3 print:border-b print:border-line print:pb-1.5">
              <h2 className="text-[18px] font-semibold print:text-[14px]">อัปเดตเว็บไซต์</h2>
              <span className="text-[13px] text-muted-ink print:text-[10.5px]">
                {updates.length} รายการ · สำรองไฟล์ก่อนอัปเดตและตรวจหน้าเว็บหลังอัปเดตทุกครั้ง
              </span>
            </div>
            <div className="space-y-6 print:space-y-4">
              {[...bySite].map(([host, list]) => (
                <div key={host}>
                  <p className="rp-keep mb-2 text-[13px] font-semibold text-ink print:text-[11.5px]">
                    {host} <span className="font-normal text-muted-ink">· {list.length} รายการ</span>
                  </p>
                  <table className="rp-table w-full border-collapse text-[13px] print:text-[10.5px]">
                    <thead>
                      <tr className="border-y border-line-soft text-left text-[11px] uppercase tracking-wide text-muted-ink print:text-[9px]">
                        <th className="py-2 pr-3 font-semibold print:py-1">รายการ</th>
                        <th className="w-24 py-2 pr-3 font-semibold print:w-16 print:py-1">ประเภท</th>
                        <th className="w-44 py-2 text-right font-semibold print:w-32 print:py-1">เวอร์ชัน</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((u) => (
                        <tr key={u.id} className="border-b border-line-soft">
                          <td className="py-2 pr-3 font-medium text-ink print:py-1">{u.name}</td>
                          <td className="py-2 pr-3 text-muted-ink print:py-1">{u.kind}</td>
                          <td className="py-2 text-right tabular-nums text-muted-ink print:py-1">
                            {u.from} → <span className="font-semibold text-ink">{u.to}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          </section>
        )}

        {tasks.length === 0 && (
          <section className="rounded-[20px] border border-line bg-white p-6 text-center text-sm text-muted-ink">ไม่มีรายการงาน</section>
        )}

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

        <p className="pb-4 text-center text-xs text-faint-ink print:pb-0 print:pt-2 print:text-[9px]">
          do action · portal.doaction.co.th
        </p>
      </main>
    </div>
  );
}
