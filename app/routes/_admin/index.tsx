import { requireCoAdminOrAdmin } from "~/lib/auth.server";
import { isContractExpired, needsMonthlyReport } from "~/lib/contract";
import { createDB } from "~/lib/db.server";
import { useT } from "~/lib/i18n";
import { formatRelativeTime, getMonthName } from "~/lib/utils";
import { useState, useEffect, useMemo, useRef } from "react";
import { useFetcher } from "react-router";
import { getBackupList } from "~/lib/backup.server";
import { fetchAllMonitors, hostOf, type MonitorSummary } from "~/lib/uptime.server";
import { getUptimeRobotKey } from "~/lib/secrets.server";
import {
  filterBackupSnapshots,
  parseBackupTimestamp,
  type BackupEntry,
  type BackupResult,
} from "~/lib/backup";
import {
  FaArrowRight, FaArrowsRotate, FaChevronLeft, FaChevronRight, FaMagnifyingGlass, FaPlus,
} from "react-icons/fa6";

const BACKUP_LOG_PAGE_SIZE = 10;
const DAY = 86400;

type QueueTicket = {
  id: string;
  title: string;
  status: string;
  company_name: string;
  updated_at: number;
};

type ReportState = "none" | "draft" | "published" | "sent";
type ReportRow = { client_id: string; company_name: string; state: ReportState; report_id: string | null };

export function meta() {
  return [{ title: "Admin Overview — do action portal" }];
}

/** Current year/month in Bangkok time (UTC+7). */
function bangkokYearMonth() {
  const d = new Date(Date.now() + 7 * 3600 * 1000);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

export async function loader({ request, context }: any) {
  const user = await requireCoAdminOrAdmin(
    request,
    context.cloudflare.env.DB,
    context.cloudflare.env.SESSIONPORTAL
  );
  const db = createDB(context.cloudflare.env.DB);
  const { year, month } = bangkokYearMonth();

  let scopeIds: string[] | undefined;
  if (user.role === "co-admin") {
    const assignments = await db.listCoAdminClients(user.id);
    scopeIds = assignments.map((a) => a.client_id);
  }
  const inScope = (id: string) => !scopeIds || scopeIds.includes(id);

  const [allClients, tickets, recentReports, withoutReport] = await Promise.all([
    db.listClients(),
    db.listTicketsWithClient(scopeIds),
    db.listRecentReportsWithClient(1, scopeIds),
    db.listClientsWithoutReportForMonth(year, month),
  ]);
  // Expired contracts are out of scope for day-to-day and report work.
  const clients = allClients.filter((c) => inScope(c.id) && !isContractExpired(c.contract_end));
  // Report progress also leaves out our own company.
  const activeIds = new Set(clients.filter(needsMonthlyReport).map((c) => c.id));

  const unresolved = tickets.filter((t) =>
    ["open", "in_progress", "waiting"].includes(t.status)
  );
  // Waiting on the team: not parked with the client. Oldest activity first.
  const queue: QueueTicket[] = unresolved
    .filter((t) => t.status === "open" || t.status === "in_progress")
    .sort((a, b) => a.updated_at - b.updated_at)
    .map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      company_name: t.company_name,
      updated_at: t.updated_at,
    }));

  const reportRows: ReportRow[] = [];
  for (const r of recentReports) {
    if (r.year !== year || r.month !== month) continue;
    if (!activeIds.has(r.client_id)) continue;
    const state: ReportState =
      r.status !== "published" ? "draft" : r.client_notified_at ? "sent" : "published";
    reportRows.push({ client_id: r.client_id, company_name: r.company_name, state, report_id: r.id });
  }
  for (const c of withoutReport) {
    if (!inScope(c.id)) continue;
    reportRows.push({ client_id: c.id, company_name: c.company_name, state: "none", report_id: null });
  }
  const order: Record<ReportState, number> = { none: 0, draft: 1, published: 2, sent: 3 };
  reportRows.sort(
    (a, b) => order[a.state] - order[b.state] || a.company_name.localeCompare(b.company_name)
  );

  // Fetch backup list — admin only (co-admins skip this)
  let backup: BackupResult = { ok: false, error: "Not available for co-admins" };
  const backupPathLabels: Record<string, string> = {};
  if (user.role === "admin") {
    backup = await getBackupList(null, context.cloudflare.env.SESSIONPORTAL, {
      cacheOnly: true,
    });
    for (const c of allClients) {
      if (c.backup_path) backupPathLabels[c.backup_path] = c.company_name;
    }
  }

  // Website uptime (admin only): one cached UptimeRobot call, matched to
  // active clients by website host.
  let uptime: UptimeData | null = null;
  if (user.role === "admin") {
    const env = context.cloudflare.env;
    const monitors = await fetchAllMonitors(getUptimeRobotKey(env), env.SESSIONPORTAL);
    if (monitors) {
      const byHost = new Map(monitors.map((m) => [m.host, m]));
      const used = new Set<string>();
      const rows = clients.map((c) => {
        const host = hostOf(c.website_url);
        const m = host ? byHost.get(host) : undefined;
        if (m) used.add(m.host);
        return { client_id: c.id, company_name: c.company_name, host, monitor: m ?? null };
      });
      uptime = { rows, others: monitors.filter((m) => !used.has(m.host)) };
    } else {
      uptime = { rows: [], others: [], unavailable: true };
    }
  }

  return {
    uptime,
    totalClients: clients.length,
    unresolvedCount: unresolved.length,
    queue,
    reportRows,
    userRole: user.role,
    backup,
    backupPathLabels,
    currentMonth: month,
    currentYear: year,
    now: Math.floor(Date.now() / 1000),
  };
}

const reportPill: Record<ReportState, string> = {
  none: "bg-paper text-muted-ink",
  draft: "bg-[#FFF6C2] text-[#6B5B00]",
  published: "bg-emerald-50 text-emerald-700",
  sent: "bg-ink text-white",
};

function getInitials(name: string) {
  const cleaned = name.replace(/^(บริษัท|บจก\.?|หจก\.?)\s*/, "");
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return Array.from(cleaned).slice(0, 2).join("").toUpperCase();
}

function ageLabel(seconds: number, t: (k: any) => string) {
  const s = Math.max(0, seconds);
  if (s >= DAY) return t("rd_admin_age_days").replace("{n}", String(Math.floor(s / DAY)));
  if (s >= 3600) return t("rd_admin_age_hours").replace("{n}", String(Math.floor(s / 3600)));
  return t("rd_admin_age_minutes").replace("{n}", String(Math.max(1, Math.floor(s / 60))));
}

type UptimeData = {
  rows: { client_id: string; company_name: string; host: string | null; monitor: MonitorSummary | null }[];
  others: MonitorSummary[];
  unavailable?: boolean;
};

function shortName(company: string) {
  return company.replace(/^บริษัท\s*/, "").replace(/\s*(จำกัด|จํากัด).*$/, "");
}

/** Per-client 30-day uptime tiles, worst first, plus monitors not tied to a client. */
function UptimeSection({ data, lang }: { data: UptimeData; lang: "th" | "en" }) {
  const L = (th: string, en: string) => (lang === "en" ? en : th);
  if (data.unavailable) {
    return (
      <section className="rounded-[20px] border border-line bg-white px-5 py-4 text-sm text-muted-ink">
        {L("ดึงข้อมูล UptimeRobot ไม่ได้ — ตรวจที่ ตั้งค่า → การเชื่อมต่อ", "UptimeRobot unavailable — check Settings → Integrations")}
      </section>
    );
  }
  const withMon = data.rows.filter((r) => r.monitor);
  const values = withMon.map((r) => r.monitor!.uptime30).filter((v): v is number => v != null);
  const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  const down = [...withMon.filter((r) => r.monitor!.state === "down")];
  // Down first, then lowest uptime, then clients without a monitor.
  const rank = (r: UptimeData["rows"][number]) =>
    !r.monitor ? 1e9 : r.monitor.state === "down" ? -1 : r.monitor.uptime30 ?? 101;
  const rows = [...data.rows].sort((a, b) => rank(a) - rank(b));

  return (
    <section className="overflow-hidden rounded-[20px] border border-line bg-white">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line-soft px-5 py-4">
        <div>
          <h2 className="text-[16px] font-semibold text-ink">{L("สถานะเว็บไซต์ลูกค้า", "Client websites")}</h2>
          <p className="mt-0.5 text-sm text-muted-ink">
            {down.length > 0
              ? L(`เว็บล่มตอนนี้ ${down.length} เว็บ`, `${down.length} site(s) down now`)
              : L("ทุกเว็บออนไลน์", "All sites online")}
            {" · "}
            {L("Uptime 30 วัน", "30-day uptime")}
          </p>
        </div>
        {avg != null && (
          <p className="text-right">
            <span className="block text-xs text-muted-ink">{L("เฉลี่ย", "Average")}</span>
            <span className="font-display text-[28px] font-bold leading-none tabular-nums text-ink">{avg.toFixed(2)}%</span>
          </p>
        )}
      </div>
      <div className="grid grid-cols-1 gap-2.5 p-4 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((r) => {
          const m = r.monitor;
          const isDown = m?.state === "down";
          const dot = !m ? "bg-line" : isDown ? "bg-[#E0622A]" : m.state === "up" ? "bg-emerald-500" : "bg-brand-yellow";
          const low = m?.uptime30 != null && m.uptime30 < 99.5;
          return (
            <a
              key={r.client_id}
              href={`/admin/clients/${r.client_id}`}
              className={`flex min-w-0 items-center gap-3 rounded-[14px] border px-3.5 py-3 transition-colors hover:border-ink/30 ${
                isDown ? "border-[#F3C9B0] bg-[#FFF5EE]" : "border-line-soft"
              }`}
            >
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${dot} ${isDown ? "animate-pulse" : ""}`} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-ink">{shortName(r.company_name)}</span>
                <span className="block truncate text-xs text-muted-ink">
                  {r.host ?? L("ไม่มีเว็บไซต์", "No website")}
                  {!m && r.host ? L(" · ไม่มี monitor", " · no monitor") : ""}
                </span>
              </span>
              <span
                className={`shrink-0 font-display text-[18px] font-bold tabular-nums ${
                  !m ? "text-faint-ink" : isDown ? "text-[#B4541A]" : low ? "text-[#B4541A]" : "text-ink"
                }`}
              >
                {m ? (isDown ? L("ล่ม", "Down") : m.uptime30 != null ? `${m.uptime30.toFixed(2)}%` : "—") : "—"}
              </span>
            </a>
          );
        })}
      </div>
      {data.others.length > 0 && (
        <p className="border-t border-line-soft px-5 py-3 text-xs text-muted-ink">
          {L("Monitor อื่นที่ไม่ผูกกับลูกค้า: ", "Other monitors: ")}
          {data.others.map((m, i) => (
            <span key={m.host || i} className={m.state === "down" ? "font-semibold text-[#B4541A]" : ""}>
              {i > 0 ? ", " : ""}
              {m.name}
              {m.state === "down" ? L(" (ล่ม)", " (down)") : ""}
            </span>
          ))}
        </p>
      )}
    </section>
  );
}

export default function AdminOverviewPage({ loaderData }: any) {
  const data = loaderData;
  const { t, lang } = useT();
  const isCoAdmin = data.userRole === "co-admin";
  const now: number = data.now;
  const monthName = getMonthName(data.currentMonth, lang);
  const rows: ReportRow[] = data.reportRows;
  const queue: QueueTicket[] = data.queue;

  const count = (s: ReportState) => rows.filter((r) => r.state === s).length;
  const sent = count("sent");
  const published = count("published");
  const drafts = count("draft");
  const notCreated = count("none");
  const overdue = queue.filter((q) => now - q.updated_at > DAY).length;
  const sentPct = rows.length ? Math.round((sent / rows.length) * 100) : 0;
  const publishedPct = rows.length ? Math.round((published / rows.length) * 100) : 0;

  const today = new Date(now * 1000).toLocaleDateString(lang === "en" ? "en-US" : "th-TH", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Bangkok",
  });

  const kpis = [
    {
      label: t("rd_admin_kpi_clients"),
      value: String(data.totalClients),
      note: t("rd_admin_kpi_clients_note").replace("{n}", String(notCreated)),
      tone: notCreated > 0 ? "text-[#B4541A]" : "text-muted-ink",
      href: "/admin/clients",
    },
    {
      label: t("rd_admin_kpi_unresolved"),
      value: String(data.unresolvedCount),
      note: t("rd_admin_kpi_overdue_note").replace("{n}", String(overdue)),
      tone: overdue > 0 ? "text-[#C2410C]" : "text-muted-ink",
      href: "/admin/tickets",
    },
    {
      label: t("rd_admin_kpi_reports_sent"),
      value: `${sent}/${rows.length}`,
      note: t("rd_admin_kpi_reports_note").replace("{n}", String(published + sent)),
      tone: rows.length > 0 && sent === rows.length ? "text-emerald-700" : "text-muted-ink",
      href: "/admin/reports",
    },
    {
      label: t("rd_admin_kpi_drafts"),
      value: String(drafts),
      note: t("rd_admin_kpi_drafts_note").replace("{n}", String(notCreated)),
      tone: "text-muted-ink",
      href: "/admin/reports",
    },
  ];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm text-muted-ink">{today}</p>
          <h1 className="mt-1.5 text-[28px] md:text-[32px] font-bold tracking-[-0.02em] text-ink">
            {data.unresolvedCount > 0
              ? t("rd_admin_headline_some").replace("{n}", String(data.unresolvedCount))
              : t("rd_admin_headline_none")}
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {!isCoAdmin && (
            <a
              href="/admin/clients/new"
              className="inline-flex h-10 items-center gap-1.5 rounded-full border border-line bg-white px-4 text-[13px] font-semibold text-ink hover:bg-paper"
            >
              <FaPlus className="text-[10px]" />
              {t("rd_admin_new_client")}
            </a>
          )}
          <a
            href="/admin/reports/new"
            className="inline-flex h-10 items-center rounded-full bg-ink px-4 text-[13px] font-semibold text-white hover:bg-black"
          >
            {t("rd_admin_create_report").replace("{month}", monthName)}
          </a>
        </div>
      </div>

      {/* KPIs */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {kpis.map((k) => (
          <a
            key={k.label}
            href={k.href}
            className="rounded-[18px] border border-line bg-white p-4 sm:p-[18px] hover:border-ink/20 transition-colors"
          >
            <p className="text-[13px] text-muted-ink">{k.label}</p>
            <p className="mt-2 font-display text-[28px] sm:text-[34px] font-bold leading-none tracking-[-0.03em] tabular-nums text-ink">
              {k.value}
            </p>
            <p className={`mt-2 text-xs ${k.tone}`}>{k.note}</p>
          </a>
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        {/* Waiting on team */}
        <div className="min-w-0 overflow-hidden rounded-[20px] border border-line bg-white">
          <div className="flex items-center justify-between gap-3 border-b border-line-soft px-5 py-[18px]">
            <h2 className="text-[16px] font-semibold text-ink">{t("rd_admin_queue_title")}</h2>
            <a href="/admin/tickets" className="inline-flex items-center gap-1 text-xs text-muted-ink hover:text-ink">
              {t("rd_admin_queue_sort")} <FaArrowRight className="text-[9px]" />
            </a>
          </div>
          {queue.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-muted-ink">{t("rd_admin_queue_empty")}</p>
          ) : (
            queue.slice(0, 8).map((q) => {
              const age = now - q.updated_at;
              const late = age > DAY;
              return (
                <a
                  key={q.id}
                  href={`/admin/tickets/${q.id}`}
                  className="flex items-center gap-3.5 border-b border-[#F4F2EC] px-5 py-3.5 last:border-b-0 hover:bg-paper/60"
                >
                  <span
                    className={`min-w-[54px] shrink-0 rounded-lg py-1 text-center text-xs font-bold tabular-nums ${
                      late ? "bg-[#FDE7DA] text-[#B4541A]" : "bg-paper text-ink-soft"
                    }`}
                  >
                    {ageLabel(age, t)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink">{q.title}</p>
                    <p className="mt-0.5 truncate text-xs text-faint-ink">{q.company_name}</p>
                  </div>
                  <span className="hidden shrink-0 whitespace-nowrap text-xs text-muted-ink sm:inline">
                    {t(`status_${q.status}` as any)}
                  </span>
                </a>
              );
            })
          )}
        </div>

        {/* Report progress */}
        <div className="min-w-0 rounded-[20px] border border-line bg-white p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-[16px] font-semibold text-ink">
              {t("rd_admin_reports_title").replace("{month}", monthName)}
            </h2>
            <span className="text-[13px] font-semibold tabular-nums text-ink">
              {t("rd_admin_reports_sent_of")
                .replace("{sent}", String(sent))
                .replace("{total}", String(rows.length))}
            </span>
          </div>
          <div className="mb-[18px] mt-3.5 flex h-2 overflow-hidden rounded-full bg-line-soft">
            <span className="bg-ink" style={{ width: `${sentPct}%` }} />
            <span className="bg-emerald-400" style={{ width: `${publishedPct}%` }} />
          </div>
          {rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-ink">{t("admin_clients_empty")}</p>
          ) : (
            <div className="flex max-h-[380px] flex-col overflow-y-auto">
              {rows.map((r) => (
                <a
                  key={r.client_id}
                  href={r.report_id ? `/admin/reports/${r.report_id}` : `/admin/clients/${r.client_id}`}
                  className="flex items-center gap-3 border-b border-dashed border-[#EDEBE4] py-2.5 last:border-b-0"
                >
                  <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px] bg-paper text-xs font-semibold text-ink">
                    {getInitials(r.company_name)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-ink">{r.company_name}</span>
                  <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${reportPill[r.state]}`}>
                    {t(`rd_admin_report_${r.state}` as any)}
                  </span>
                </a>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Website uptime — admin only */}
      {!isCoAdmin && data.uptime && <UptimeSection data={data.uptime} lang={lang} />}

      {/* Site health — admin only */}
      {!isCoAdmin && (
        <BackupSection
          backup={data.backup}
          backupPathLabels={data.backupPathLabels}
          t={t}
          lang={lang}
        />
      )}
    </div>
  );
}

type BackupLogItem = {
  siteName: string;
  clientLabel: string | null;
  backup: BackupEntry;
  timestamp: number;
};

function buildBackupLog(
  entries: BackupEntry[],
  backupPathLabels: Record<string, string>
): BackupLogItem[] {
  return entries
    .flatMap((site) =>
      filterBackupSnapshots(site.children ?? []).map((backup) => ({
        siteName: site.name,
        clientLabel: backupPathLabels[site.name] ?? null,
        backup,
        timestamp: backupTimestamp(backup),
      }))
    )
    .filter((item) => item.timestamp > 0)
    .sort((a, b) => b.timestamp - a.timestamp);
}

function BackupSection({
  backup: initialBackup,
  backupPathLabels,
  t,
  lang,
}: {
  backup: BackupResult;
  backupPathLabels: Record<string, string>;
  t: (k: any) => string;
  lang: "th" | "en";
}) {
  const fetcher = useFetcher<{ backup: BackupResult }>();
  const [backup, setBackup] = useState(initialBackup);

  useEffect(() => {
    setBackup(initialBackup);
  }, [initialBackup]);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.backup) {
      setBackup(fetcher.data.backup);
    }
  }, [fetcher.state, fetcher.data]);

  const refreshing = fetcher.state !== "idle";
  const onRefresh = () =>
    fetcher.submit(null, { method: "post", action: "/api/admin/backup-refresh" });

  // The loader only reads cache, so pull a fresh list once the page is up.
  const requested = useRef(false);
  useEffect(() => {
    if (requested.current) return;
    if (initialBackup.ok || initialBackup.error !== "not_loaded") return;
    requested.current = true;
    fetcher.submit(null, { method: "post", action: "/api/admin/backup-refresh" });
  }, [initialBackup, fetcher]);

  const [tab, setTab] = useState<"log" | "sites">("sites");

  const logCount = useMemo(
    () => (backup.ok ? buildBackupLog(backup.entries, backupPathLabels).length : 0),
    [backup, backupPathLabels]
  );
  const siteCount = backup.ok ? backup.entries.length : 0;

  const tabClass = (active: boolean) =>
    `inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium transition-colors ${
      active ? "bg-white text-ink shadow-[0_1px_2px_rgba(0,0,0,0.08)]" : "text-muted-ink hover:text-ink"
    }`;

  return (
    <section className="overflow-hidden rounded-[20px] border border-line bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5">
        <div className="min-w-0">
          <h2 className="text-[16px] font-semibold text-ink">{t("rd_admin_health_title")}</h2>
          <p className="mt-0.5 text-xs text-muted-ink">
            {t("rd_admin_health_meta")}
            {backup.ok &&
              ` · ${backup.fromCache ? t("admin_backup_cached") : t("admin_backup_live")} ${formatRelativeTime(backup.fetchedAt, lang)}`}
          </p>
        </div>
        <button
          type="button"
          disabled={refreshing}
          onClick={onRefresh}
          className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border border-line bg-white px-4 text-[13px] font-semibold text-ink hover:bg-paper disabled:opacity-50"
        >
          <FaArrowsRotate className={`text-[11px] ${refreshing ? "animate-spin" : ""}`} />
          {refreshing ? t("admin_backup_refreshing") : t("admin_backup_refresh")}
        </button>
      </div>

      <div className="px-5 pb-1 pt-4">
        <div className="inline-flex rounded-full bg-paper p-[3px]">
          <button type="button" onClick={() => setTab("sites")} className={tabClass(tab === "sites")}>
            {t("admin_backup_sites")}
            {siteCount > 0 && <span className="text-faint-ink">{siteCount}</span>}
          </button>
          <button type="button" onClick={() => setTab("log")} className={tabClass(tab === "log")}>
            {t("admin_backup_log_title")}
            {logCount > 0 && <span className="text-faint-ink">{logCount}</span>}
          </button>
        </div>
      </div>

      {tab === "log" ? (
        <BackupLogPanel backup={backup} backupPathLabels={backupPathLabels} t={t} lang={lang} />
      ) : (
        <BackupPanel backup={backup} backupPathLabels={backupPathLabels} t={t} lang={lang} />
      )}
    </section>
  );
}

function BackupLogPanel({
  backup,
  backupPathLabels,
  t,
  lang,
}: {
  backup: BackupResult;
  backupPathLabels: Record<string, string>;
  t: (k: any) => string;
  lang: "th" | "en";
}) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const entries = backup.ok ? backup.entries : [];
  const fetchedAt = backup.ok ? backup.fetchedAt : 0;

  const allLogItems = useMemo(
    () => buildBackupLog(entries, backupPathLabels),
    [entries, backupPathLabels]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allLogItems;
    return allLogItems.filter((item) => {
      const label = (item.clientLabel ?? item.siteName).toLowerCase();
      return (
        label.includes(q) ||
        item.siteName.toLowerCase().includes(q) ||
        item.backup.name.toLowerCase().includes(q)
      );
    });
  }, [allLogItems, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / BACKUP_LOG_PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageItems = filtered.slice(
    safePage * BACKUP_LOG_PAGE_SIZE,
    safePage * BACKUP_LOG_PAGE_SIZE + BACKUP_LOG_PAGE_SIZE
  );
  const showPagination = filtered.length > BACKUP_LOG_PAGE_SIZE;

  useEffect(() => {
    setPage(0);
  }, [search]);

  useEffect(() => {
    setPage(0);
  }, [fetchedAt]);

  useEffect(() => {
    if (page > totalPages - 1) setPage(Math.max(0, totalPages - 1));
  }, [filtered.length, page, totalPages]);

  return (
    <div className="flex flex-col">
      <div className="px-5 py-3 border-b border-line-soft">
        <p className="text-[11px] text-muted-ink">{t("admin_backup_log_subtitle")}</p>
      </div>

      {backup.ok && allLogItems.length > 0 && (
        <div className="px-5 py-3 border-b border-line-soft">
          <div className="relative">
            <FaMagnifyingGlass className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint-ink text-xs" />
            <input
              type="search"
              placeholder={t("admin_backup_log_search")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full h-10 rounded-xl border border-line bg-white pl-9 pr-3.5 text-sm text-ink placeholder:text-faint-ink focus:outline-none focus:ring-2 focus:ring-ink/10 focus:border-ink/40 transition"
            />
          </div>
        </div>
      )}

      {!backup.ok ? (
        <div className="px-5 py-4">
          {(backup as { error: string }).error === "not_loaded" ? (
            <p className="text-sm text-muted-ink">{t("admin_backup_loading")}</p>
          ) : (
            <p className="text-sm text-[#B4541A]">
              {t("admin_backup_error")}: {(backup as { error: string }).error}
            </p>
          )}
        </div>
      ) : allLogItems.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-muted-ink">{t("admin_backup_log_empty")}</p>
      ) : filtered.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-muted-ink">{t("admin_backup_log_no_results")}</p>
      ) : (
        <>
          <div className="overflow-x-auto flex-1">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-line-soft bg-transparent">
                  <th className="px-5 py-2.5 text-[11px] font-medium text-muted-ink">
                    {t("admin_backup_log_site")}
                  </th>
                  <th className="px-3 py-2.5 text-[11px] font-medium text-muted-ink hidden sm:table-cell">
                    {t("admin_backup_log_file")}
                  </th>
                  <th className="px-5 py-2.5 text-[11px] font-medium text-muted-ink text-right">
                    {t("admin_backup_log_date")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F4F2EC]">
                {pageItems.map((item) => (
                  <tr key={`${item.siteName}-${item.backup.relativePath ?? item.backup.name}`} className="hover:bg-paper/60">
                    <td className="px-5 py-2.5">
                      <p className="text-xs font-medium text-ink truncate max-w-[140px] sm:max-w-none">
                        {item.clientLabel ?? item.siteName}
                      </p>
                      {item.clientLabel ? (
                        <p className="text-[12px] text-faint-ink font-mono truncate mt-0.5">
                          {item.siteName}
                        </p>
                      ) : null}
                      <p className="text-[12px] text-muted-ink font-mono truncate mt-0.5 sm:hidden">
                        {item.backup.name}
                      </p>
                    </td>
                    <td className="px-3 py-2.5 hidden sm:table-cell">
                      <p className="text-[12px] text-ink-soft font-mono truncate max-w-[200px]">
                        {item.backup.name}
                      </p>
                    </td>
                    <td className="px-5 py-2.5 text-right whitespace-nowrap">
                      <p className="text-xs text-ink-soft">
                        {formatBackupDate(item.backup, lang)}
                      </p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-line-soft bg-transparent">
            {search.trim() && (
              <p className="px-5 pt-2.5 text-[11px] text-muted-ink">
                {t("admin_backup_log_showing")
                  .replace("{shown}", String(filtered.length))
                  .replace("{total}", String(allLogItems.length))}
              </p>
            )}
            {showPagination && (
              <div className="flex items-center justify-between gap-2 px-5 py-3">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={safePage === 0}
                  className="inline-flex items-center gap-1 h-10 rounded-full border border-line bg-white px-3.5 text-xs font-semibold text-ink hover:bg-paper disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <FaChevronLeft className="text-[9px]" />
                  {t("admin_pagination_prev")}
                </button>
                <span className="text-[11px] text-muted-ink tabular-nums">
                  {t("admin_pagination_page")
                    .replace("{current}", String(safePage + 1))
                    .replace("{total}", String(totalPages))}
                </span>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={safePage >= totalPages - 1}
                  className="inline-flex items-center gap-1 h-10 rounded-full border border-line bg-white px-3.5 text-xs font-semibold text-ink hover:bg-paper disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {t("admin_pagination_next")}
                  <FaChevronRight className="text-[9px]" />
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function BackupPanel({
  backup,
  backupPathLabels,
  t,
  lang,
}: {
  backup: BackupResult;
  backupPathLabels: Record<string, string>;
  t: (k: any) => string;
  lang: "th" | "en";
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const entries = backup.ok ? backup.entries : [];
  const now = Math.floor(Date.now() / 1000);

  const sites = useMemo(
    () =>
      entries.map((entry) => {
        const snapshots = filterBackupSnapshots(entry.children ?? []);
        const latest = snapshots.reduce<BackupEntry | null>(
          (best, b) => (backupTimestamp(b) > (best ? backupTimestamp(best) : 0) ? b : best),
          null
        );
        const ts = latest ? backupTimestamp(latest) : 0;
        return { entry, snapshots, latest, healthy: ts > 0 && now - ts < 2 * DAY };
      }),
    [entries, now]
  );
  const totalBackups = sites.reduce((n, s) => n + s.snapshots.length, 0);
  const openSite = sites.find((s) => s.entry.name === selected) ?? null;

  if (!backup.ok) {
    return (
      <div className="px-5 py-5">
        {(backup as { error: string }).error === "not_loaded" ? (
          <p className="text-sm text-muted-ink">{t("admin_backup_loading")}</p>
        ) : (
          <p className="text-sm text-[#B4541A]">
            {t("admin_backup_error")}: {(backup as { error: string }).error}
          </p>
        )}
      </div>
    );
  }
  if (entries.length === 0) {
    return <p className="px-5 py-8 text-center text-sm text-muted-ink">{t("admin_backup_empty")}</p>;
  }

  return (
    <div className="px-5 pb-5 pt-3">
      <p className="mb-3 text-xs text-muted-ink">
        {t("admin_backup_items_total")}: <span className="font-semibold tabular-nums text-ink">{totalBackups}</span>
        {" · "}
        {t("admin_backup_host")}: <span className="font-mono">cloud.aumwp.com</span>
      </p>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-[repeat(auto-fill,minmax(200px,1fr))]">
        {sites.map(({ entry, snapshots, latest, healthy }) => {
          const active = selected === entry.name;
          return (
            <button
              key={entry.name}
              type="button"
              onClick={() => setSelected(active ? null : entry.name)}
              disabled={snapshots.length === 0}
              aria-expanded={active}
              title={healthy ? undefined : latest ? t("rd_admin_health_stale") : t("rd_admin_health_no_backup")}
              className={`min-h-[40px] rounded-[14px] border p-3.5 text-left transition-colors ${
                healthy ? "border-[#EDEBE4] bg-white" : "border-[#F6D3B0] bg-[#FFF7EE]"
              } ${active ? "ring-2 ring-ink/15" : "hover:border-ink/20"} disabled:cursor-default`}
            >
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 shrink-0 rounded-full ${healthy ? "bg-[#22A55B]" : "bg-[#F08A24]"}`} />
                <span className="truncate text-[13px] font-semibold text-ink">
                  {backupPathLabels[entry.name] ?? entry.name}
                </span>
              </div>
              {backupPathLabels[entry.name] && (
                <p className="mt-0.5 truncate pl-4 font-mono text-[11px] text-faint-ink">{entry.name}</p>
              )}
              <div className="mt-2.5 flex justify-between gap-2 text-xs text-muted-ink">
                <span className="font-semibold tabular-nums text-ink">
                  {t("admin_backup_items_count").replace("{count}", String(snapshots.length))}
                </span>
                <span className="truncate">
                  {latest ? formatBackupDate(latest, lang) : t("rd_admin_health_no_backup")}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {openSite && (
        <div className="mt-3 overflow-hidden rounded-[14px] border border-line">
          <div className="border-b border-line-soft bg-paper/60 px-4 py-2.5 text-[13px] font-semibold text-ink">
            {backupPathLabels[openSite.entry.name] ?? openSite.entry.name}
          </div>
          <ul>
            {openSite.snapshots.map((b) => (
              <li
                key={b.relativePath ?? b.name}
                className="flex items-center gap-3 border-b border-[#F4F2EC] px-4 py-2.5 last:border-b-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-xs text-ink-soft">{b.name}</p>
                  <p className="mt-0.5 text-[11px] text-faint-ink">{t("admin_backup_snapshot")}</p>
                </div>
                <span className="shrink-0 text-xs text-muted-ink">{formatBackupDate(b, lang)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function backupTimestamp(entry: BackupEntry): number {
  return entry.lastModified || parseBackupTimestamp(entry.name) || 0;
}

function formatBackupDate(entry: BackupEntry, lang: "th" | "en"): string {
  const ts = backupTimestamp(entry);
  if (!ts) return entry.name;
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 604800) return formatRelativeTime(ts, lang);
  const locale = lang === "en" ? "en-US" : "th-TH";
  return new Date(ts * 1000).toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
