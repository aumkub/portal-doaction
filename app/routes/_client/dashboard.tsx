import { CheckCircle2, Globe, Zap, Ticket, ArrowRight } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { th } from "date-fns/locale";
import type { Route } from "./+types/dashboard";
import { requireUser } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";
import StatsCard from "~/components/dashboard/StatsCard";
import PageHeader from "~/components/layout/PageHeader";
import type { SupportTicket, ReportTask } from "~/types";

export function meta() {
  return [{ title: "Dashboard — DoAction Portal" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const user = await requireUser(request, env.DB, env.SESSION_KV);
  const db = createDB(env.DB);
  const client = await db.getClientByUserId(user.id);
  if (!client) {
    return { stats: null, activity: [], client: null };
  }

  const [tickets, reports] = await Promise.all([
    db.listTicketsByClient(client.id),
    db.listReportsByClient(client.id),
  ]);

  const latestReport = reports.find((r) => r.status === "published") ?? null;
  const tasks = latestReport
    ? await db.listTasksByReport(latestReport.id)
    : [];

  const openTickets = tickets.filter((t) =>
    ["open", "in_progress", "waiting"].includes(t.status)
  );

  // Build activity feed: merge recent tasks + tickets, sort by time, take 5
  type ActivityItem = {
    id: string;
    type: "task" | "ticket";
    title: string;
    icon: string;
    time: number;
  };

  const taskItems: ActivityItem[] = tasks.slice(0, 5).map((t) => ({
    id: t.id,
    type: "task",
    title: t.title,
    icon: "✅",
    time: latestReport!.created_at,
  }));

  const ticketItems: ActivityItem[] = tickets.slice(0, 5).map((t) => ({
    id: t.id,
    type: "ticket",
    title: t.title,
    icon: t.status === "resolved" ? "✅" : t.status === "in_progress" ? "🔄" : "🎫",
    time: t.updated_at,
  }));

  const activity = [...taskItems, ...ticketItems]
    .sort((a, b) => b.time - a.time)
    .slice(0, 5);

  return {
    stats: {
      completedTasks: latestReport?.total_tasks ?? 0,
      uptimePercent: latestReport?.uptime_percent ?? null,
      speedScore: latestReport?.speed_score ?? null,
      openTickets: openTickets.length,
      prevSpeedScore: null as number | null, // from previous report if available
    },
    activity,
    client,
    latestReportId: latestReport?.id ?? null,
  };
}

export default function DashboardPage({ loaderData }: Route.ComponentProps) {
  const { stats, activity, client, latestReportId } = loaderData;

  const fmt = (unix: number) =>
    formatDistanceToNow(new Date(unix * 1000), { addSuffix: true, locale: th });

  return (
    <div className="space-y-6 max-w-6xl">
      <PageHeader
        title={`สวัสดี, ${client?.company_name ?? "ลูกค้า"}`}
        subtitle="ภาพรวมการดูแลเว็บไซต์ของคุณ"
      />

      {/* ── Stat Cards ───────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatsCard
          title="งานเสร็จเดือนนี้"
          value={stats?.completedTasks ?? 0}
          suffix="รายการ"
          icon={<CheckCircle2 className="w-5 h-5" />}
          color="emerald"
        />
        <StatsCard
          title="Uptime"
          value={
            stats?.uptimePercent != null
              ? `${stats.uptimePercent.toFixed(2)}%`
              : "—"
          }
          icon={<Globe className="w-5 h-5" />}
          color="blue"
        />
        <StatsCard
          title="Speed Score"
          value={stats?.speedScore ?? "—"}
          suffix={stats?.speedScore != null ? "/ 100" : undefined}
          icon={<Zap className="w-5 h-5" />}
          color="amber"
          trend={
            stats?.speedScore != null && stats?.prevSpeedScore != null
              ? {
                  value: stats.speedScore - stats.prevSpeedScore,
                  label: "vs เดือนก่อน",
                }
              : undefined
          }
        />
        <StatsCard
          title="Tickets เปิดอยู่"
          value={stats?.openTickets ?? 0}
          suffix="รายการ"
          icon={<Ticket className="w-5 h-5" />}
          color="violet"
        />
      </div>

      {/* ── Bottom grid ──────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Activity — 2/3 width */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 p-5">
          <h2 className="text-sm font-semibold text-slate-900 mb-4">
            กิจกรรมล่าสุด
          </h2>
          {activity.length === 0 ? (
            <p className="text-slate-400 text-sm py-6 text-center">
              ยังไม่มีกิจกรรม
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {activity.map((item) => (
                <li key={item.id} className="flex items-center gap-3 py-3">
                  <span className="text-lg leading-none shrink-0">
                    {item.icon}
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
              Quick Actions
            </h2>
            <div className="space-y-2">
              <a
                href="/tickets?new=1"
                className="flex items-center justify-between w-full rounded-lg bg-[#F0D800] px-4 py-2.5 text-sm font-medium text-slate-900 hover:bg-yellow-400 transition-colors group"
              >
                <span>+ แจ้งงานใหม่</span>
                <ArrowRight className="w-4 h-4 opacity-60 group-hover:translate-x-0.5 transition-transform" />
              </a>
              <a
                href={latestReportId ? `/reports/${latestReportId}` : "/reports"}
                className="flex items-center justify-between w-full rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors group"
              >
                <span>📄 ดู Report ล่าสุด</span>
                <ArrowRight className="w-4 h-4 opacity-40 group-hover:translate-x-0.5 transition-transform" />
              </a>
              <a
                href="mailto:support@doaction.co.th"
                className="flex items-center justify-between w-full rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors group"
              >
                <span>💬 ติดต่อทีม</span>
                <ArrowRight className="w-4 h-4 opacity-40 group-hover:translate-x-0.5 transition-transform" />
              </a>
            </div>
          </div>

          {/* Website Status */}
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <h2 className="text-sm font-semibold text-slate-900 mb-3">
              Website Status
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
                  label="สถานะ"
                  value={
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                      <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
                      Online
                    </span>
                  }
                />
                <StatusRow label="SSL Certificate" value="ยังไม่ได้ตั้งค่า" />
                <StatusRow label="Domain Expiry" value="ยังไม่ได้ตั้งค่า" />
              </div>
            ) : (
              <p className="text-slate-400 text-sm">ยังไม่มีข้อมูลเว็บไซต์</p>
            )}
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
