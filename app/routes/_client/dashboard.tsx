import { Plus } from "lucide-react";
import { getUptimeRobotKey } from "~/lib/secrets.server";
import { getClientBackupFromCache, parseBackupTimestamp, type BackupEntry } from "~/lib/backup";
import type { Route } from "./+types/dashboard";
import { requireUser } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";
import { formatDate, formatRelativeTime } from "~/lib/utils";
import { useT } from "~/lib/i18n";
import type { ReportTask } from "~/types";
import { StatusStepper } from "~/components/tickets/StatusStepper";
import type { TranslationKey } from "~/lib/translations";

export function meta() {
  return [{ title: "Dashboard — do action portal" }];
}

const MONITOR_UP = 2;

async function fetchUptimeForDomain(
  websiteUrl: string,
  apiKey: string
): Promise<{ uptimeRatio: number | null; isUp: boolean | null }> {
  try {
    const domain = new URL(websiteUrl).hostname.replace(/^www\./, "");
    const body = new URLSearchParams({
      api_key: apiKey,
      format: "json",
      custom_uptime_ratios: "30",
    });
    const resp = await fetch("https://api.uptimerobot.com/v2/getMonitors", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!resp.ok) return { uptimeRatio: null, isUp: null };
    const data = (await resp.json()) as {
      stat?: string;
      monitors?: Array<{ url?: string; status?: number; custom_uptime_ratio?: string }>;
    };
    if (data.stat !== "ok" || !data.monitors) return { uptimeRatio: null, isUp: null };
    const monitor = data.monitors.find((m) => {
      if (!m.url) return false;
      try { return new URL(m.url).hostname.replace(/^www\./, "") === domain; } catch { return false; }
    });
    if (!monitor) return { uptimeRatio: null, isUp: null };
    const ratio = monitor.custom_uptime_ratio
      ? parseFloat(monitor.custom_uptime_ratio.split("-")[0])
      : null;
    return {
      uptimeRatio: ratio != null && !isNaN(ratio) ? ratio : null,
      isUp: monitor.status === MONITOR_UP,
    };
  } catch {
    return { uptimeRatio: null, isUp: null };
  }
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const user = await requireUser(request, env.DB, env.SESSIONPORTAL);
  const db = createDB(env.DB);
  const client = await db.getClientByUserId(user.id);
  if (!client) return { stats: null, client: null, latestReport: null, categoryCounts: [], recentTasks: [], inProgress: [], clientBackup: null };

  const apiKey = getUptimeRobotKey(env);

  const [ticketsResult, reportsResult, uptimeResult] = await Promise.allSettled([
    db.listTicketsByClient(client.id),
    db.listReportsByClient(client.id),
    client.website_url
      ? fetchUptimeForDomain(client.website_url, apiKey)
      : Promise.resolve({ uptimeRatio: null, isUp: null }),
  ]);

  const tickets = ticketsResult.status === "fulfilled" ? ticketsResult.value : [];
  const reports = reportsResult.status === "fulfilled" ? reportsResult.value : [];
  const uptime = uptimeResult.status === "fulfilled" ? uptimeResult.value : { uptimeRatio: null, isUp: null };

  const latestReport = reports.find((r) => r.status === "published") ?? null;
  const tasks = latestReport ? await db.listTasksByReport(latestReport.id) : [];
  const openTickets = tickets.filter((t) => ["open", "in_progress", "waiting"].includes(t.status));

  const clientBackup = await getClientBackupFromCache(env.SESSIONPORTAL, client.backup_path);

  const categoryOrder: ReportTask["category"][] = ["maintenance", "security", "seo", "performance", "development", "other"];
  const categoryCounts = categoryOrder
    .map((category) => ({ category, count: tasks.filter((t) => t.category === category).length }))
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count);

  const inProgress = openTickets
    .slice()
    .sort((a, b) => b.updated_at - a.updated_at)
    .slice(0, 3)
    .map((t) => ({ id: t.id, title: t.title, status: t.status, updated_at: t.updated_at }));

  return {
    stats: {
      uptimePercent: uptime.uptimeRatio,
      isUp: uptime.isUp,
      openTickets: openTickets.length,
    },
    client,
    latestReport: latestReport
      ? { id: latestReport.id, year: latestReport.year, month: latestReport.month, total_tasks: latestReport.total_tasks }
      : null,
    categoryCounts,
    recentTasks: tasks.slice(0, 3).map((t) => ({ id: t.id, title: t.title, category: t.category })),
    inProgress,
    clientBackup,
  };
}

function backupEntryTime(entry: BackupEntry): number {
  return entry.lastModified || parseBackupTimestamp(entry.name) || 0;
}

function formatBackupWhen(entry: BackupEntry, locale: "th" | "en"): string {
  const ts = backupEntryTime(entry);
  if (!ts) return entry.name;
  return new Date(ts * 1000).toLocaleDateString(locale === "en" ? "en-US" : "th-TH", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const CATEGORY_KEY: Record<ReportTask["category"], TranslationKey> = {
  maintenance: "cat_maintenance",
  development: "cat_development",
  security: "cat_security",
  seo: "cat_seo",
  performance: "cat_performance",
  other: "cat_other",
};

export default function DashboardPage({ loaderData }: Route.ComponentProps) {
  const { stats, client, latestReport, categoryCounts, recentTasks, inProgress, clientBackup } = loaderData;
  const { t, lang } = useT();
  const isOnline = stats?.isUp ?? null;
  const host = client?.website_url?.replace(/^https?:\/\//, "").replace(/\/$/, "") ?? null;
  const maxCount = Math.max(1, ...categoryCounts.map((c) => c.count));
  const reportMonth = latestReport
    ? new Date(latestReport.year, latestReport.month - 1, 1).toLocaleDateString(lang === "en" ? "en-US" : "th-TH", { month: "long", year: "numeric" })
    : null;
  const greeting = isOnline === true ? t("rd_client_greeting_ok") : isOnline === false ? t("rd_client_greeting_down") : t("rd_client_greeting_neutral");
  const latestBackup = clientBackup && clientBackup.ok !== false ? clientBackup.latest : null;

  return (
    <div className="space-y-5 md:space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <p className="text-sm text-muted-ink">
            {client?.company_name ?? t("dash_default_client")}
            {client?.package ? ` · ${client.package}` : ""}
          </p>
          <h1 className="mt-1 text-[28px] md:text-[32px] font-bold leading-tight tracking-[-0.02em] text-ink">{greeting}</h1>
        </div>
        <a
          href="/tickets/new"
          className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-full bg-ink px-5 text-[14px] font-semibold text-white hover:bg-black"
        >
          <Plus className="h-4 w-4" />
          {t("rd_client_report_issue")}
        </a>
      </div>

      {/* Hero row */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3 md:gap-5">
        <div className="lg:col-span-2 rounded-[24px] bg-ink p-6 md:p-7 text-white">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span
                className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                  isOnline === true ? "bg-emerald-400" : isOnline === false ? "bg-[#FF8A3D]" : "bg-white/40"
                }`}
              />
              <div className="min-w-0">
                {host ? (
                  <a href={client!.website_url!} target="_blank" rel="noopener noreferrer" className="block truncate text-[15px] font-semibold text-white hover:underline">
                    {host}
                  </a>
                ) : (
                  <p className="text-[15px] font-semibold">{t("dash_no_website")}</p>
                )}
                <p className="text-[13px] text-white/60">
                  {isOnline === true ? t("rd_client_online") : isOnline === false ? t("rd_client_offline") : t("dash_unknown")}
                </p>
              </div>
            </div>
            <span className="shrink-0 rounded-full bg-white/10 px-2.5 py-1 text-xs text-white/70">{t("rd_client_last_30d")}</span>
          </div>
          <div className="mt-8">
            <p className="font-display text-[56px] md:text-[64px] font-bold leading-none tracking-[-0.03em] tabular-nums text-brand-yellow">
              {stats?.uptimePercent != null ? `${stats.uptimePercent.toFixed(2)}%` : "—"}
            </p>
            <p className="mt-2 text-sm text-white/60">Uptime</p>
          </div>
          {latestBackup ? (
            <div className="mt-7 border-t border-white/10 pt-5">
              <p className="text-xs text-white/50">{t("dash_backup_latest")}</p>
              <p className="mt-1 text-[15px] font-semibold">{formatBackupWhen(latestBackup, lang)}</p>
            </div>
          ) : null}
        </div>

        <div className="flex flex-col justify-between gap-6 rounded-[24px] bg-brand-yellow p-6 md:p-7 text-ink">
          <div>
            <p className="text-sm font-medium text-ink/70">{t("rd_client_latest_report")}</p>
            {latestReport ? (
              <>
                <p className="mt-2 font-display text-[28px] font-bold leading-tight tracking-[-0.02em]">{reportMonth}</p>
                <p className="mt-2 text-sm text-ink/80">{t("rd_client_report_summary", { count: latestReport.total_tasks })}</p>
              </>
            ) : (
              <p className="mt-2 text-[15px] font-semibold">{t("rd_client_no_report")}</p>
            )}
          </div>
          <a
            href={latestReport ? `/reports/${latestReport.id}` : "/reports"}
            className="inline-flex h-11 items-center justify-center rounded-full bg-ink px-5 text-[13px] font-semibold text-white hover:bg-black"
          >
            {latestReport ? t("rd_client_read_report") : t("nav_reports")}
          </a>
        </div>
      </section>

      {/* Second row */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2 md:gap-5">
        <div className="rounded-[20px] border border-line bg-white p-5 md:p-6">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-[16px] font-semibold text-ink">{t("rd_client_work_done")}</h2>
            {reportMonth ? <span className="text-[13px] text-muted-ink">{reportMonth}</span> : null}
          </div>
          {categoryCounts.length === 0 ? (
            <p className="mt-5 text-sm text-muted-ink">{t("rd_client_no_work")}</p>
          ) : (
            <>
              <div className="mt-5 space-y-3">
                {categoryCounts.map((c) => (
                  <div key={c.category} className="flex items-center gap-3">
                    <span className="w-28 shrink-0 truncate text-sm text-ink-soft">{t(CATEGORY_KEY[c.category])}</span>
                    <span className="h-2 flex-1 overflow-hidden rounded-full bg-paper">
                      <span className="block h-full rounded-full bg-ink" style={{ width: `${(c.count / maxCount) * 100}%` }} />
                    </span>
                    <span className="w-6 shrink-0 text-right text-sm font-semibold tabular-nums">{c.count}</span>
                  </div>
                ))}
              </div>
              {recentTasks.length > 0 ? (
                <ul className="mt-5 space-y-3 border-t border-line-soft pt-4">
                  {recentTasks.map((task) => (
                    <li key={task.id} className="flex items-start gap-3">
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-ink" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-ink">{task.title}</p>
                        <p className="text-xs text-muted-ink">{t(CATEGORY_KEY[task.category])}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          )}
        </div>

        <div className="flex flex-col gap-4 md:gap-5">
          <div className="overflow-hidden rounded-[20px] border border-line bg-white">
            <div className="flex items-baseline justify-between gap-3 px-5 pt-5 md:px-6">
              <h2 className="text-[16px] font-semibold text-ink">{t("rd_client_in_progress_title")}</h2>
              <a href="/tickets" className="text-[13px] font-medium text-muted-ink hover:text-ink">{t("rd_client_view_all")}</a>
            </div>
            {inProgress.length === 0 ? (
              <p className="px-5 pb-5 pt-4 text-sm text-muted-ink md:px-6">{t("rd_client_no_in_progress")}</p>
            ) : (
              <ul className="mt-3">
                {inProgress.map((tk) => (
                  <li key={tk.id} className="border-t border-[#F4F2EC]">
                    <a href={`/tickets/${tk.id}`} className="block px-5 py-4 hover:bg-paper/60 md:px-6">
                      <div className="mb-3 flex items-start justify-between gap-3">
                        <p className="min-w-0 text-sm font-semibold text-ink">{tk.title}</p>
                        <span className="shrink-0 text-xs text-faint-ink">
                          {t("rd_client_updated", { when: formatRelativeTime(tk.updated_at, lang) })}
                        </span>
                      </div>
                      <StatusStepper status={tk.status} lang={lang} />
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-col gap-4 rounded-[20px] border border-line bg-white p-5 sm:flex-row sm:items-center sm:justify-between md:p-6">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink">
                {client?.contract_end
                  ? t("rd_client_contract_until", { date: formatDate(new Date(client.contract_end).getTime() / 1000, lang) })
                  : t("dash_contract_no_expiry")}
              </p>
              <p className="mt-0.5 text-[13px] text-muted-ink">{t("rd_client_contact_hint")}</p>
            </div>
            <a
              href="/contact"
              className="inline-flex h-10 shrink-0 items-center justify-center rounded-full border border-line bg-white px-5 text-[13px] font-semibold text-ink hover:bg-paper"
            >
              {t("dash_contact_team")}
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
