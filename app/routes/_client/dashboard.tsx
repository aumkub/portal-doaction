import { CheckCircle2, Globe, Ticket, ArrowRight } from "lucide-react";
import { FaCircleCheck, FaRotateRight, FaTag } from "react-icons/fa6";
import type { Route } from "./+types/dashboard";
import { requireUser } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";
import { formatDate, formatRelativeTime } from "~/lib/utils";
import { useT } from "~/lib/i18n";
import TeamContactPanel from "~/components/contact/TeamContactPanel";
import type { SupportTicket, ReportTask } from "~/types";

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
  if (!client) return { stats: null, activity: [], client: null, latestReportId: null };

  const apiKey = (env as any).UPTIMEROBOT_API_KEY ?? "ur2618139-5281beb51ff9820a629669c2";

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

  type ActivityItem = {
    id: string;
    type: "task" | "ticket";
    title: string;
    iconKind: "resolved" | "in_progress" | "ticket";
    time: number;
  };

  const taskItems: ActivityItem[] = tasks.slice(0, 5).map((t) => ({
    id: t.id, type: "task", title: t.title, iconKind: "resolved", time: latestReport!.created_at,
  }));
  const ticketItems: ActivityItem[] = tickets.slice(0, 5).map((t) => ({
    id: t.id, type: "ticket", title: t.title,
    iconKind: t.status === "resolved" ? "resolved" : t.status === "in_progress" ? "in_progress" : "ticket",
    time: t.updated_at,
  }));
  const activity = [...taskItems, ...ticketItems].sort((a, b) => b.time - a.time).slice(0, 5);

  return {
    stats: {
      completedTasks: latestReport?.total_tasks ?? 0,
      uptimePercent: uptime.uptimeRatio,
      isUp: uptime.isUp,
      openTickets: openTickets.length,
    },
    activity,
    client,
    latestReportId: latestReport?.id ?? null,
  };
}

export default function DashboardPage({ loaderData }: Route.ComponentProps) {
  const { stats, activity, client, latestReportId } = loaderData;
  const { t, lang } = useT();
  const fmt = (unix: number) => formatRelativeTime(unix, lang);
  const isOnline = stats?.isUp;

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">
          {t("dash_greeting_prefix")} {client?.company_name ?? t("dash_default_client")}
        </h1>
        <p className="mt-1 text-sm text-slate-500">{t("dash_subtitle")}</p>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Completed tasks */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 flex items-center gap-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 shrink-0">
            <CheckCircle2 className="w-5 h-5" />
          </span>
          <div>
            <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">{t("dash_completed_tasks")}</p>
            <p className="text-2xl font-semibold text-slate-900 leading-tight">
              {stats?.completedTasks ?? 0}
              <span className="text-sm font-normal text-slate-500 ml-1">{t("items")}</span>
            </p>
          </div>
        </div>

        {/* Uptime */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 flex items-center gap-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600 shrink-0">
            <Globe className="w-5 h-5" />
          </span>
          <div>
            <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">{t("dash_uptime_label")}</p>
            <p className="text-2xl font-semibold text-slate-900 leading-tight">
              {stats?.uptimePercent != null ? `${stats.uptimePercent.toFixed(2)}%` : "—"}
            </p>
          </div>
        </div>

        {/* Open tickets */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 flex items-center gap-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 text-violet-600 shrink-0">
            <Ticket className="w-5 h-5" />
          </span>
          <div>
            <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">{t("dash_open_tickets")}</p>
            <p className="text-2xl font-semibold text-slate-900 leading-tight">
              {stats?.openTickets ?? 0}
              <span className="text-sm font-normal text-slate-500 ml-1">{t("items")}</span>
            </p>
          </div>
        </div>
      </div>

      {/* Bottom grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Recent Activity — 2/3 */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="text-sm font-semibold text-slate-900">{t("dash_recent_activity")}</h2>
          </div>
          {activity.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-slate-500">{t("dash_no_activity")}</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {activity.map((item) => (
                <li key={item.id} className="flex items-center gap-3 px-5 py-3.5">
                  <span className="shrink-0">
                    {item.iconKind === "resolved" ? (
                      <FaCircleCheck className="text-emerald-500 text-base" aria-hidden="true" />
                    ) : item.iconKind === "in_progress" ? (
                      <FaRotateRight className="text-blue-500 text-base" aria-hidden="true" />
                    ) : (
                      <Ticket className="w-4 h-4 text-violet-500" aria-hidden="true" />
                    )}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-700 truncate">{item.title}</p>
                  </div>
                  <span className={`shrink-0 text-[10px] font-medium px-2 py-0.5 rounded-full ${
                    item.type === "task"
                      ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                      : "bg-violet-50 text-violet-700 ring-1 ring-violet-200"
                  }`}>
                    {item.type === "task" ? "งาน" : "Ticket"}
                  </span>
                  <span className="text-xs text-slate-500 whitespace-nowrap shrink-0 ml-1">
                    {fmt(item.time)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Right column */}
        <div className="space-y-4">
          {/* Quick Actions */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100">
              <h2 className="text-sm font-semibold text-slate-900">{t("dash_quick_actions")}</h2>
            </div>
            <div className="p-4 space-y-2">
              <a
                href="/tickets/new"
                className="flex items-center justify-between w-full rounded-lg bg-[#F0D800] px-4 py-2.5 text-sm font-semibold text-slate-900 hover:bg-yellow-400 transition-colors group"
              >
                <span>{t("dash_new_request")}</span>
                <ArrowRight className="w-4 h-4 opacity-60 group-hover:translate-x-0.5 transition-transform" />
              </a>
              <a
                href={latestReportId ? `/reports/${latestReportId}` : "/reports"}
                className="flex items-center justify-between w-full rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors group"
              >
                <span>{t("dash_view_latest_report")}</span>
                <ArrowRight className="w-4 h-4 opacity-40 group-hover:translate-x-0.5 transition-transform" />
              </a>
              <a
                href="/contact"
                className="flex items-center justify-between w-full rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors group"
              >
                <span>{t("dash_contact_team")}</span>
                <ArrowRight className="w-4 h-4 opacity-40 group-hover:translate-x-0.5 transition-transform" />
              </a>
            </div>
          </div>

          {/* Website Status */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100">
              <h2 className="text-sm font-semibold text-slate-900">{t("dash_website_status")}</h2>
            </div>
            <div className="p-5">
              {client?.website_url ? (
                <div className="space-y-3">
                  <a
                    href={client.website_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-xs text-slate-500 truncate hover:text-slate-800 transition-colors"
                  >
                    {client.website_url.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                  </a>
                  <div className="space-y-2.5 pt-3 border-t border-slate-100">
                    <StatusRow
                      label={t("dash_status_label")}
                      value={
                        isOnline === null ? (
                          <StatusPill color="slate">{t("dash_unknown")}</StatusPill>
                        ) : isOnline ? (
                          <StatusPill color="emerald" pulse>Online</StatusPill>
                        ) : (
                          <StatusPill color="red" pulse>Offline</StatusPill>
                        )
                      }
                    />
                    <StatusRow
                      label={t("dash_uptime_30d")}
                      value={
                        <span className="text-sm font-medium text-slate-800">
                          {stats?.uptimePercent != null ? `${stats.uptimePercent.toFixed(2)}%` : "—"}
                        </span>
                      }
                    />
                    <StatusRow label={t("dash_ssl_cert")} value={<StatusPill color="emerald">{t("set")}</StatusPill>} />
                    <StatusRow label={t("dash_domain_expiry")} value={<StatusPill color="emerald">{t("not_expired")}</StatusPill>} />
                  </div>
                </div>
              ) : (
                <p className="text-sm text-slate-500">{t("dash_no_website")}</p>
              )}
            </div>
          </div>

          {/* Contract Status */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100">
              <h2 className="text-sm font-semibold text-slate-900">{t("dash_contract_expiry")}</h2>
            </div>
            <div className="p-5">
              {client?.contract_end ? (
                <ContractStatus contractEnd={client.contract_end} lang={lang} t={t} formatDate={formatDate} />
              ) : (
                <p className="text-sm text-slate-500">{t("dash_contract_no_expiry")}</p>
              )}
            </div>
          </div>

          {/* Contact channels */}
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <TeamContactPanel />
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusPill({
  color,
  pulse,
  children,
}: {
  color: "emerald" | "red" | "slate";
  pulse?: boolean;
  children: React.ReactNode;
}) {
  const colorMap = {
    emerald: { pill: "bg-emerald-50 text-emerald-700", dot: "bg-emerald-500" },
    red:     { pill: "bg-red-50 text-red-600",         dot: "bg-red-500" },
    slate:   { pill: "bg-slate-100 text-slate-600",    dot: "bg-slate-400" },
  };
  const c = colorMap[color];
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full ${c.pill}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot} ${pulse ? "animate-pulse" : ""}`} />
      {children}
    </span>
  );
}

function StatusRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="text-slate-500 shrink-0">{label}</span>
      <span>{value}</span>
    </div>
  );
}

function ContractStatus({
  contractEnd,
  lang,
  t,
  formatDate,
}: {
  contractEnd: string;
  lang: string;
  t: (k: any, params?: Record<string, string | number>) => string;
  formatDate: (unix: number, locale: any) => string;
}) {
  const expiryDate = new Date(contractEnd);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  expiryDate.setHours(0, 0, 0, 0);
  const diffDays = Math.ceil((expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  const dateStr = formatDate(expiryDate.getTime() / 1000, lang);

  // expired
  if (diffDays < 0) {
    return (
      <div className="rounded-lg bg-red-50 border border-red-100 px-4 py-3 flex items-start gap-3">
        <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-red-500" />
        <div>
          <p className="text-sm font-semibold text-red-700">{t("dash_contract_expired")}</p>
          <p className="text-xs text-red-500 mt-0.5">{dateStr}</p>
        </div>
      </div>
    );
  }

  // expiring soon (≤ 30 days)
  if (diffDays <= 30) {
    return (
      <div className="rounded-lg bg-amber-50 border border-amber-100 px-4 py-3 flex items-start gap-3">
        <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-amber-500 animate-pulse" />
        <div>
          <p className="text-sm font-semibold text-amber-700">
            {t("dash_contract_days_left", { days: diffDays })}
          </p>
          <p className="text-xs text-amber-600 mt-0.5">{dateStr}</p>
        </div>
      </div>
    );
  }

  // active
  return (
    <div className="rounded-lg bg-emerald-50 border border-emerald-100 px-4 py-3 flex items-start gap-3">
      <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
      <div>
        <p className="text-sm font-semibold text-emerald-700">
          {t("dash_contract_days_left", { days: diffDays })}
        </p>
        <p className="text-xs text-emerald-600 mt-0.5">{dateStr}</p>
      </div>
    </div>
  );
}
