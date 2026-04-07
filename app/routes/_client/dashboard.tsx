import { CheckCircle2, Globe, Ticket, ArrowRight } from "lucide-react";
import { FaCircleCheck, FaRotateRight } from "react-icons/fa6";
import type { Route } from "./+types/dashboard";
import { requireUser } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";
import { formatDate, formatRelativeTime } from "~/lib/utils";
import { useT } from "~/lib/i18n";
import TeamContactPanel from "~/components/contact/TeamContactPanel";
import StatsCard from "~/components/dashboard/StatsCard";
import PageHeader from "~/components/layout/PageHeader";
import type { SupportTicket, ReportTask } from "~/types";

export function meta() {
  return [{ title: "Dashboard — do action portal" }];
}

// UptimeRobot monitor status codes
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
      monitors?: Array<{
        url?: string;
        status?: number;
        custom_uptime_ratio?: string;
      }>;
    };

    if (data.stat !== "ok" || !data.monitors) return { uptimeRatio: null, isUp: null };

    const monitor = data.monitors.find((m) => {
      if (!m.url) return false;
      try {
        return new URL(m.url).hostname.replace(/^www\./, "") === domain;
      } catch {
        return false;
      }
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
  if (!client) {
    return { stats: null, activity: [], client: null, latestReportId: null };
  }

  const apiKey =
    (env as any).UPTIMEROBOT_API_KEY ?? "ur2618139-5281beb51ff9820a629669c2";

  const [ticketsResult, reportsResult, uptimeResult] = await Promise.allSettled([
    db.listTicketsByClient(client.id),
    db.listReportsByClient(client.id),
    client.website_url
      ? fetchUptimeForDomain(client.website_url, apiKey)
      : Promise.resolve({ uptimeRatio: null, isUp: null }),
  ]);

  const tickets = ticketsResult.status === "fulfilled" ? ticketsResult.value : [];
  const reports = reportsResult.status === "fulfilled" ? reportsResult.value : [];
  const uptime =
    uptimeResult.status === "fulfilled"
      ? uptimeResult.value
      : { uptimeRatio: null, isUp: null };

  const latestReport = reports.find((r) => r.status === "published") ?? null;
  const tasks = latestReport ? await db.listTasksByReport(latestReport.id) : [];

  const openTickets = tickets.filter((t) =>
    ["open", "in_progress", "waiting"].includes(t.status)
  );

  type ActivityItem = {
    id: string;
    type: "task" | "ticket";
    title: string;
    iconKind: "resolved" | "in_progress" | "ticket";
    time: number;
  };

  const taskItems: ActivityItem[] = tasks.slice(0, 5).map((t) => ({
    id: t.id,
    type: "task",
    title: t.title,
    iconKind: "resolved",
    time: latestReport!.created_at,
  }));

  const ticketItems: ActivityItem[] = tickets.slice(0, 5).map((t) => ({
    id: t.id,
    type: "ticket",
    title: t.title,
    iconKind: t.status === "resolved" ? "resolved" : t.status === "in_progress" ? "in_progress" : "ticket",
    time: t.updated_at,
  }));

  const activity = [...taskItems, ...ticketItems]
    .sort((a, b) => b.time - a.time)
    .slice(0, 5);

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
      <PageHeader
        title={`${t("dash_greeting_prefix")} ${client?.company_name ?? t("dash_default_client")}`}
        subtitle={t("dash_subtitle")}
      />

      {/* ── Stat Cards ───────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatsCard
          title={t("dash_completed_tasks")}
          value={stats?.completedTasks ?? 0}
          suffix={t("items")}
          icon={<CheckCircle2 className="w-5 h-5" />}
          color="emerald"
        />
        <StatsCard
          title={t("dash_uptime_label")}
          value={
            stats?.uptimePercent != null
              ? `${stats.uptimePercent.toFixed(2)}%`
              : "—"
          }
          icon={<Globe className="w-5 h-5" />}
          color="blue"
        />
        <StatsCard
          title={t("dash_open_tickets")}
          value={stats?.openTickets ?? 0}
          suffix={t("items")}
          icon={<Ticket className="w-5 h-5" />}
          color="violet"
        />
      </div>

      {/* ── Bottom grid ──────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Activity — 2/3 width */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 p-5">
          <h2 className="text-sm font-semibold text-slate-900 mb-4">
            {t("dash_recent_activity")}
          </h2>
          {activity.length === 0 ? (
            <p className="text-slate-400 text-sm py-6 text-center">
              {t("dash_no_activity")}
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {activity.map((item) => (
                <li key={item.id} className="flex items-center gap-3 py-3">
                  <span className="text-lg leading-none shrink-0">
                    {item.iconKind === "resolved" ? (
                      <FaCircleCheck className="text-emerald-500" aria-hidden="true" />
                    ) : item.iconKind === "in_progress" ? (
                      <FaRotateRight className="text-blue-500" aria-hidden="true" />
                    ) : (
                      <Ticket className="w-4 h-4 text-violet-600" aria-hidden="true" />
                    )}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-700 truncate">
                      {item.title}
                    </p>
                  </div>
                  <span className="text-xs text-slate-400 whitespace-nowrap shrink-0">
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
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <h2 className="text-sm font-semibold text-slate-900 mb-3">
              {t("dash_quick_actions")}
            </h2>
            <div className="space-y-2">
              <a
                href="/tickets?new=1"
                className="flex items-center justify-between w-full rounded-lg bg-[#F0D800] px-4 py-2.5 text-sm font-medium text-slate-900 hover:bg-yellow-400 transition-colors group"
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
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <h2 className="text-sm font-semibold text-slate-900 mb-3">
              {t("dash_website_status")}
            </h2>
            {client?.website_url ? (
              <div className="space-y-3">
                <a
                  href={client.website_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-sm text-slate-600 truncate hover:text-slate-900 transition-colors"
                >
                  {client.website_url.replace(/^https?:\/\//, "")}
                </a>

                <StatusRow
                  label={t("dash_status_label")}
                  value={
                    isOnline === null ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 bg-slate-50 px-2 py-0.5 rounded-full">
                        <span className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-[ping_1.2s_cubic-bezier(0,0,0.2,1)_infinite,signal-blink_1.2s_cubic-bezier(0.5,0,1,1)_infinite]" style={{ animationName: "ping, signal-blink" }} />
                        {t("dash_unknown")}
                      </span>
                    ) : isOnline ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                        <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-[ping_1s_cubic-bezier(0,0,0.2,1)_infinite,signal-blink_1s_cubic-bezier(0.5,0,1,1)_infinite]" style={{ animationName: "ping, signal-blink" }} />
                        Online
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-600 bg-red-50 px-2 py-0.5 rounded-full">
                        <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-[ping_1s_cubic-bezier(0,0,0.2,1)_infinite,signal-blink_1s_cubic-bezier(0.5,0,1,1)_infinite]" style={{ animationName: "ping, signal-blink" }} />
                        Offline
                      </span>
                    )
                  }
                />
                <StatusRow
                  label={t("dash_uptime_30d")}
                  value={
                    stats?.uptimePercent != null
                      ? `${stats.uptimePercent.toFixed(2)}%`
                      : "—"
                  }
                />
                <StatusRow label={t("dash_ssl_cert")} value={t("set")} />
                <StatusRow label={t("dash_domain_expiry")} value={t("not_expired")} />
              </div>
            ) : (
              <p className="text-slate-400 text-sm">{t("dash_no_website")}</p>
            )}
          </div>

          {/* Contract Status */}
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <h2 className="text-sm font-semibold text-slate-900 mb-3">
              {t("dash_contract_expiry")}
            </h2>
            {client?.contract_end ? (
              <div>
                {(() => {
                  const expiryDate = new Date(client.contract_end);
                  const today = new Date();
                  today.setHours(0, 0, 0, 0);
                  expiryDate.setHours(0, 0, 0, 0);
                  
                  const diffTime = expiryDate.getTime() - today.getTime();
                  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                  if (diffDays < 0) {
                    return (
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-600 bg-red-50 px-2 py-0.5 rounded-full">
                        {t("dash_contract_expired")}
                      </span>
                    );
                  } else if (diffDays <= 30) {
                    return (
                      <div className="space-y-2">
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
                          {t("dash_contract_days_left", { days: diffDays })}
                        </span>
                        <p className="text-xs text-slate-600">
                          {formatDate(expiryDate.getTime() / 1000, lang)}
                        </p>
                      </div>
                    );
                  } else {
                    return (
                      <div className="space-y-2">
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                          {t("dash_contract_days_left", { days: diffDays })}
                        </span>
                        <p className="text-xs text-slate-600">
                          {formatDate(expiryDate.getTime() / 1000, lang)}
                        </p>
                      </div>
                    );
                  }
                })()}
              </div>
            ) : (
              <p className="text-slate-400 text-sm">{t("dash_contract_no_expiry")}</p>
            )}
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

function StatusRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="text-slate-700">{value}</span>
    </div>
  );
}
