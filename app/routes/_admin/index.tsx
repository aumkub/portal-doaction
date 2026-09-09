import { requireCoAdminOrAdmin } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";
import { useT } from "~/lib/i18n";
import { formatRelativeTime, formatBytes } from "~/lib/utils";
import { useState, useEffect, useMemo } from "react";
import { useFetcher } from "react-router";
import { getBackupList } from "~/lib/backup.server";
import {
  filterBackupSnapshots,
  parseBackupTimestamp,
  type BackupEntry,
  type BackupResult,
} from "~/lib/backup";
import {
  FaUsers, FaTicket, FaFileLines,
  FaArrowRight, FaDatabase, FaFolder, FaBoxArchive, FaArrowsRotate, FaChevronDown,
  FaChevronLeft, FaChevronRight, FaMagnifyingGlass,
} from "react-icons/fa6";

const CLIENTS_PAGE_SIZE = 6;
const BACKUP_LOG_PAGE_SIZE = 10;

type DashboardTicket = {
  id: string;
  title: string;
  priority: string;
  status: string;
  company_name: string;
  client_id: string;
};

type DashboardClient = {
  id: string;
  company_name: string;
  package: "basic" | "standard" | "premium";
};

export function meta() {
  return [{ title: "Admin Overview — do action portal" }];
}

export async function loader({ request, context }: any) {
  const user = await requireCoAdminOrAdmin(
    request,
    context.cloudflare.env.DB,
    context.cloudflare.env.SESSIONPORTAL
  );
  const db = createDB(context.cloudflare.env.DB);
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  let assignedClientIds: string[] = [];
  if (user.role === "co-admin") {
    const assignments = await db.listCoAdminClients(user.id);
    assignedClientIds = assignments.map((a) => a.client_id);
  }

  const dueReportsQuery =
    user.role === "co-admin"
      ? `SELECT COUNT(*) as count FROM monthly_reports WHERE year = ? AND month = ? AND client_id IN (${assignedClientIds.map(() => "?").join(",")})`
      : "SELECT COUNT(*) as count FROM monthly_reports WHERE year = ? AND month = ?";
  const dueReportsParams =
    user.role === "co-admin" ? [year, month, ...assignedClientIds] : [year, month];
  const openTicketsQuery =
    user.role === "co-admin"
      ? `SELECT t.id, t.title, t.priority, t.status, c.company_name, c.id as client_id
         FROM support_tickets t JOIN clients c ON c.id = t.client_id
         WHERE t.status IN ('open', 'in_progress') AND t.client_id IN (${assignedClientIds.map(() => "?").join(",")})
         ORDER BY t.created_at DESC LIMIT 6`
      : `SELECT t.id, t.title, t.priority, t.status, c.company_name, c.id as client_id
         FROM support_tickets t JOIN clients c ON c.id = t.client_id
         WHERE t.status IN ('open', 'in_progress')
         ORDER BY t.created_at DESC LIMIT 6`;
  const openTicketsParams = user.role === "co-admin" ? [...assignedClientIds] : [];

  const [allClients, dueReports, openTicketsResult] = await Promise.all([
    db.listClients(),
    context.cloudflare.env.DB.prepare(dueReportsQuery).bind(...dueReportsParams).first(),
    context.cloudflare.env.DB.prepare(openTicketsQuery).bind(...openTicketsParams).all(),
  ]);
  const clients =
    user.role === "co-admin"
      ? allClients.filter((c) => assignedClientIds.includes(c.id))
      : allClients;

  const urgentTickets: DashboardTicket[] =
    (openTicketsResult as { results?: DashboardTicket[] }).results ?? [];

  // Fetch backup list — admin only (co-admins skip this)
  let backup: BackupResult = { ok: false, error: "Not available for co-admins" };
  const backupPathLabels: Record<string, string> = {};
  if (user.role === "admin") {
    // Read WebDAV settings from database
    const [enabled, url, username, password, path] = await Promise.all([
      db.getAppSetting("webdav_enabled"),
      db.getAppSetting("webdav_url"),
      db.getAppSetting("webdav_username"),
      db.getAppSetting("webdav_password"),
      db.getAppSetting("webdav_path"),
    ]);
    let webdavConfig = null;

    if (enabled === "0") {
      backup = { ok: false, error: "WebDAV backup is disabled in settings" };
    } else {
      if (!url || !username || !password) {
        backup = { ok: false, error: "WebDAV credentials not configured. Please configure in Settings." };
      } else {
        webdavConfig = { url, username, password, path: path || "/home/Backup" };
      }
    }
    
    if (webdavConfig) {
      const env = context.cloudflare.env;
      backup = await getBackupList(webdavConfig, env.SESSIONPORTAL);
    }
    
    for (const c of allClients) {
      if (c.backup_path) backupPathLabels[c.backup_path] = c.company_name;
    }
  }

  return {
    totalClients: clients.length,
    reportsDueThisMonth: (dueReports as { count?: number } | null)?.count ?? 0,
    openTickets: urgentTickets.length,
    urgentTickets,
    clients: clients as DashboardClient[],
    userRole: user.role,
    backup,
    backupPathLabels,
    currentMonth: month,
    currentYear: year,
  };
}

const packageStyles = {
  basic:    "bg-slate-100 text-slate-600 ring-1 ring-slate-200",
  standard: "bg-blue-50 text-blue-600 ring-1 ring-blue-200",
  premium:  "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
} as const;

const priorityDot = {
  urgent:  "bg-red-500",
  high:    "bg-orange-400",
  medium:  "bg-amber-400",
  low:     "bg-slate-300",
} as const;

const statusStyles: Record<string, string> = {
  open:        "bg-blue-50 text-blue-700 ring-1 ring-blue-200",
  in_progress: "bg-violet-50 text-violet-700 ring-1 ring-violet-200",
  waiting:     "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
  resolved:    "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
  closed:      "bg-slate-100 text-slate-600 ring-1 ring-slate-200",
};

function getInitials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

function avatarColor(name: string) {
  const colors = [
    "bg-violet-100 text-violet-700",
    "bg-blue-100 text-blue-700",
    "bg-emerald-100 text-emerald-700",
    "bg-orange-100 text-orange-700",
    "bg-rose-100 text-rose-700",
    "bg-indigo-100 text-indigo-700",
    "bg-teal-100 text-teal-700",
    "bg-pink-100 text-pink-700",
  ];
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) & 0xffff;
  return colors[hash % colors.length];
}

export default function AdminOverviewPage({ loaderData }: any) {
  const data = loaderData;
  const { t, lang } = useT();
  const isCoAdmin = data.userRole === "co-admin";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">
          {isCoAdmin ? "ภาพรวม Co-Admin" : t("admin_overview_title")}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {isCoAdmin ? "ข้อมูลสำหรับลูกค้าที่คุณดูแล" : t("admin_overview_subtitle")}
        </p>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-xl border border-slate-200 bg-white px-5 py-4 flex items-center gap-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 text-violet-600 shrink-0">
            <FaUsers className="text-base" />
          </span>
          <div>
            <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">{t("admin_stat_total_clients")}</p>
            <p className="text-2xl font-semibold text-slate-900 leading-tight">{data.totalClients}</p>
          </div>
        </div>
        <div className="rounded-xl border border-blue-100 bg-blue-50 px-5 py-4 flex items-center gap-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 text-blue-600 shrink-0">
            <FaTicket className="text-base" />
          </span>
          <div>
            <p className="text-[11px] font-medium text-blue-600 uppercase tracking-wide">{t("admin_stat_open_tickets")}</p>
            <p className="text-2xl font-semibold text-blue-700 leading-tight">{data.openTickets}</p>
          </div>
        </div>
        <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-5 py-4 flex items-center gap-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600 shrink-0">
            <FaFileLines className="text-base" />
          </span>
          <div>
            <p className="text-[11px] font-medium text-emerald-600 uppercase tracking-wide">{t("admin_stat_reports_due")}</p>
            <p className="text-2xl font-semibold text-emerald-700 leading-tight">{data.reportsDueThisMonth}</p>
          </div>
        </div>
      </div>

      {/* Main grid */}
      <div className="grid gap-5 lg:grid-cols-2">
        <ClientsPanel clients={data.clients} t={t} />

        {/* Open Tickets */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
            <h2 className="text-sm font-semibold text-slate-900">{t("admin_section_quick_reply")}</h2>
            <a href="/admin/tickets" className="inline-flex items-center gap-1 text-xs font-medium text-violet-600 hover:text-violet-700 transition-colors">
              {t("admin_open_tickets_link")} <FaArrowRight className="text-[9px]" />
            </a>
          </div>
          <div className="divide-y divide-slate-50">
            {data.urgentTickets.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-slate-500">{t("admin_no_urgent")}</p>
            ) : (
              data.urgentTickets.map((ticket: DashboardTicket) => (
                <a
                  key={ticket.id}
                  href={`/admin/tickets/${ticket.id}`}
                  className="flex items-start gap-3 px-5 py-3 hover:bg-slate-50 transition-colors group"
                >
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${priorityDot[ticket.priority as keyof typeof priorityDot] ?? "bg-slate-300"}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-800 truncate group-hover:text-slate-900 leading-snug">
                      {ticket.title}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">{ticket.company_name}</p>
                  </div>
                  <span className={`shrink-0 text-[11px] font-medium px-2 py-0.5 rounded-full ${statusStyles[ticket.status] ?? ""}`}>
                    {ticket.status.replace("_", " ")}
                  </span>
                </a>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Backup — admin only */}
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

  const [tab, setTab] = useState<"log" | "sites">("log");

  const logCount = useMemo(
    () => (backup.ok ? buildBackupLog(backup.entries, backupPathLabels).length : 0),
    [backup, backupPathLabels]
  );
  const siteCount = backup.ok ? backup.entries.length : 0;

  const tabClass = (active: boolean) =>
    `inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
      active
        ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200"
        : "text-slate-500 hover:text-slate-700"
    }`;

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-slate-100">
        <div className="flex items-center gap-2 min-w-0">
          <FaBoxArchive className="text-emerald-500 text-sm shrink-0" />
          <h2 className="text-sm font-semibold text-slate-900">{t("admin_backup_title")}</h2>
          {backup.ok && (
            <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full shrink-0 ${
              backup.fromCache
                ? "bg-amber-50 text-amber-700 ring-1 ring-amber-200"
                : "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
            }`}>
              {backup.fromCache ? t("admin_backup_cached") : t("admin_backup_live")}
              {` · ${formatRelativeTime(backup.fetchedAt, lang)}`}
            </span>
          )}
        </div>
        <button
          type="button"
          disabled={refreshing}
          onClick={onRefresh}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors shrink-0"
        >
          <FaArrowsRotate className={`text-[10px] ${refreshing ? "animate-spin" : ""}`} />
          {refreshing ? t("admin_backup_refreshing") : t("admin_backup_refresh")}
        </button>
      </div>

      <div className="flex items-center gap-1 px-3 py-2 border-b border-slate-100 bg-slate-50/60">
        <button type="button" onClick={() => setTab("log")} className={tabClass(tab === "log")}>
          <FaBoxArchive className="text-[10px]" />
          {t("admin_backup_log_title")}
          {logCount > 0 && <span className="text-slate-400">({logCount})</span>}
        </button>
        <button type="button" onClick={() => setTab("sites")} className={tabClass(tab === "sites")}>
          <FaDatabase className="text-[10px]" />
          {t("admin_backup_sites")}
          {siteCount > 0 && <span className="text-slate-400">({siteCount})</span>}
        </button>
      </div>

      {tab === "log" ? (
        <BackupLogPanel backup={backup} backupPathLabels={backupPathLabels} t={t} lang={lang} />
      ) : (
        <BackupPanel backup={backup} t={t} lang={lang} />
      )}
    </div>
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
      <div className="px-5 py-3 border-b border-slate-100">
        <p className="text-[11px] text-slate-500">{t("admin_backup_log_subtitle")}</p>
      </div>

      {backup.ok && allLogItems.length > 0 && (
        <div className="px-5 py-3 border-b border-slate-100">
          <div className="relative">
            <FaMagnifyingGlass className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs" />
            <input
              type="search"
              placeholder={t("admin_backup_log_search")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white pl-8 pr-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-400 transition"
            />
          </div>
        </div>
      )}

      {!backup.ok ? (
        <div className="px-5 py-4">
          <p className="text-sm text-red-600">
            {t("admin_backup_error")}: {(backup as { error: string }).error}
          </p>
        </div>
      ) : allLogItems.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-slate-500">{t("admin_backup_log_empty")}</p>
      ) : filtered.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-slate-500">{t("admin_backup_log_no_results")}</p>
      ) : (
        <>
          <div className="overflow-x-auto flex-1">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/80">
                  <th className="px-5 py-2.5 text-[10px] font-medium text-slate-500 uppercase tracking-wide">
                    {t("admin_backup_log_site")}
                  </th>
                  <th className="px-3 py-2.5 text-[10px] font-medium text-slate-500 uppercase tracking-wide hidden sm:table-cell">
                    {t("admin_backup_log_file")}
                  </th>
                  <th className="px-5 py-2.5 text-[10px] font-medium text-slate-500 uppercase tracking-wide text-right">
                    {t("admin_backup_log_date")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {pageItems.map((item) => (
                  <tr key={`${item.siteName}-${item.backup.relativePath ?? item.backup.name}`} className="hover:bg-slate-50/80">
                    <td className="px-5 py-2.5">
                      <p className="text-xs font-medium text-slate-800 truncate max-w-[140px] sm:max-w-none">
                        {item.clientLabel ?? item.siteName}
                      </p>
                      {item.clientLabel ? (
                        <p className="text-[12px] text-slate-400 font-mono truncate mt-0.5">
                          {item.siteName}
                        </p>
                      ) : null}
                      <p className="text-[12px] text-slate-500 font-mono truncate mt-0.5 sm:hidden">
                        {item.backup.name}
                      </p>
                    </td>
                    <td className="px-3 py-2.5 hidden sm:table-cell">
                      <p className="text-[12px] text-slate-600 font-mono truncate max-w-[200px]">
                        {item.backup.name}
                      </p>
                    </td>
                    <td className="px-5 py-2.5 text-right whitespace-nowrap">
                      <p className="text-xs text-slate-600">
                        {formatBackupDate(item.backup, lang)}
                      </p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-slate-100 bg-slate-50/50">
            {search.trim() && (
              <p className="px-5 pt-2.5 text-[11px] text-slate-500">
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
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <FaChevronLeft className="text-[9px]" />
                  {t("admin_pagination_prev")}
                </button>
                <span className="text-[11px] text-slate-500 tabular-nums">
                  {t("admin_pagination_page")
                    .replace("{current}", String(safePage + 1))
                    .replace("{total}", String(totalPages))}
                </span>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={safePage >= totalPages - 1}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
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
  t,
  lang,
}: {
  backup: BackupResult;
  t: (k: any) => string;
  lang: "th" | "en";
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const entries = backup.ok ? backup.entries : [];

  // Collapse all site rows by default whenever backup data loads or refreshes
  useEffect(() => {
    if (!backup.ok || entries.length === 0) return;
    setCollapsed(new Set(entries.map((e) => e.name)));
  }, [backup.ok, backup.ok ? backup.fetchedAt : 0]);
  const allBackups = entries.flatMap((e) => filterBackupSnapshots(e.children ?? []));
  const latestBackup = allBackups.reduce<BackupEntry | null>((best, b) => {
    const ts = backupTimestamp(b);
    const bestTs = best ? backupTimestamp(best) : 0;
    return ts > bestTs ? b : best;
  }, null);
  const totalBackups = allBackups.length;
  const siteNames = entries.map((e) => e.name);
  const allCollapsed = siteNames.length > 0 && siteNames.every((n) => collapsed.has(n));
  const allExpanded = siteNames.every((n) => !collapsed.has(n));

  const expandAll = () => setCollapsed(new Set());
  const collapseAll = () => setCollapsed(new Set(siteNames));

  return (
    <div className="flex flex-col">
      {!backup.ok ? (
        <div className="px-5 py-4">
          <p className="text-sm text-red-600">{t("admin_backup_error")}: {(backup as { error: string }).error}</p>
        </div>
      ) : entries.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-slate-500">{t("admin_backup_empty")}</p>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-slate-100 border-b border-slate-100">
            <div className="bg-white px-5 py-3">
              <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wide">{t("admin_backup_sites")}</p>
              <p className="text-xl font-semibold text-slate-800 leading-tight mt-0.5">{entries.length}</p>
            </div>
            <div className="bg-white px-5 py-3">
              <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wide">{t("admin_backup_items_total")}</p>
              <p className="text-xl font-semibold text-slate-800 leading-tight mt-0.5">{totalBackups}</p>
            </div>
            <div className="bg-white px-5 py-3">
              <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wide">{t("admin_backup_last")}</p>
              <p className="text-sm font-medium text-slate-700 mt-0.5 truncate">
                {latestBackup
                  ? formatBackupDate(latestBackup, lang)
                  : "—"}
              </p>
            </div>
            <div className="bg-white px-5 py-3 hidden sm:block">
              <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wide">{t("admin_backup_host")}</p>
              <p className="text-sm font-medium text-slate-700 mt-0.5 font-mono">cloud.aumwp.com</p>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 px-5 py-2 border-b border-slate-50 bg-slate-50/30">
            <button
              type="button"
              onClick={expandAll}
              disabled={allExpanded}
              className="text-[11px] font-medium text-violet-600 hover:text-violet-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {t("admin_backup_expand_all")}
            </button>
            <span className="text-slate-300">|</span>
            <button
              type="button"
              onClick={collapseAll}
              disabled={allCollapsed}
              className="text-[11px] font-medium text-slate-500 hover:text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {t("admin_backup_collapse_all")}
            </button>
          </div>

          <ul className="divide-y divide-slate-100">
            {entries.map((entry) => (
              <BackupSiteRow
                key={entry.name}
                entry={entry}
                collapsed={collapsed.has(entry.name)}
                onToggle={() => {
                  setCollapsed((prev) => {
                    const next = new Set(prev);
                    if (next.has(entry.name)) next.delete(entry.name);
                    else next.add(entry.name);
                    return next;
                  });
                }}
                t={t}
                lang={lang}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function ClientsPanel({
  clients,
  t,
}: {
  clients: DashboardClient[];
  t: (k: any) => string;
}) {
  const [page, setPage] = useState(0);
  const totalPages = Math.max(1, Math.ceil(clients.length / CLIENTS_PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageClients = clients.slice(
    safePage * CLIENTS_PAGE_SIZE,
    safePage * CLIENTS_PAGE_SIZE + CLIENTS_PAGE_SIZE
  );
  const showPagination = clients.length > CLIENTS_PAGE_SIZE;

  useEffect(() => {
    if (page > totalPages - 1) setPage(Math.max(0, totalPages - 1));
  }, [clients.length, page, totalPages]);

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
        <h2 className="text-sm font-semibold text-slate-900">
          {t("admin_section_clients")}
          {clients.length > 0 && (
            <span className="ml-2 text-[11px] font-normal text-slate-400">({clients.length})</span>
          )}
        </h2>
        <a href="/admin/clients" className="inline-flex items-center gap-1 text-xs font-medium text-violet-600 hover:text-violet-700 transition-colors">
          {t("admin_view_all")} <FaArrowRight className="text-[9px]" />
        </a>
      </div>
      <div className="divide-y divide-slate-50">
        {clients.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-slate-500">{t("admin_clients_empty")}</p>
        ) : (
          pageClients.map((client) => (
            <a
              key={client.id}
              href={`/admin/clients/${client.id}`}
              className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50 transition-colors group"
            >
              <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${avatarColor(client.company_name)}`}>
                {getInitials(client.company_name)}
              </span>
              <span className="flex-1 min-w-0 text-sm font-medium text-slate-800 truncate group-hover:text-slate-900">
                {client.company_name}
              </span>
              <span className={`shrink-0 text-[11px] font-medium px-2 py-0.5 rounded-full capitalize ${packageStyles[client.package]}`}>
                {client.package}
              </span>
            </a>
          ))
        )}
      </div>
      {showPagination && (
        <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-slate-100 bg-slate-50/50">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={safePage === 0}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <FaChevronLeft className="text-[9px]" />
            {t("admin_pagination_prev")}
          </button>
          <span className="text-[11px] text-slate-500 tabular-nums">
            {t("admin_pagination_page")
              .replace("{current}", String(safePage + 1))
              .replace("{total}", String(totalPages))}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={safePage >= totalPages - 1}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {t("admin_pagination_next")}
            <FaChevronRight className="text-[9px]" />
          </button>
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

function BackupSiteRow({
  entry,
  collapsed,
  onToggle,
  t,
  lang,
}: {
  entry: BackupEntry;
  collapsed: boolean;
  onToggle: () => void;
  t: (k: any) => string;
  lang: "th" | "en";
}) {
  const backups = filterBackupSnapshots(entry.children ?? []);
  const hasBackups = backups.length > 0;
  const open = hasBackups && !collapsed;

  return (
    <li className="group">
      <button
        type="button"
        onClick={hasBackups ? onToggle : undefined}
        disabled={!hasBackups}
        aria-expanded={open}
        className={`w-full flex items-center gap-3 px-5 py-3 text-left transition-colors ${
          hasBackups ? "hover:bg-slate-50 cursor-pointer" : "cursor-default bg-slate-50/50"
        } ${open ? "bg-slate-50/80" : "bg-white"}`}
      >
        <span
          className={`shrink-0 flex h-5 w-5 items-center justify-center rounded text-slate-400 transition-transform duration-200 ${
            open ? "rotate-0" : "-rotate-90"
          } ${!hasBackups ? "opacity-0" : ""}`}
        >
          <FaChevronDown className="text-[10px]" />
        </span>
        <FaFolder className={`text-base shrink-0 ${open ? "text-amber-500" : "text-amber-400"}`} />
        <span className="flex-1 min-w-0 text-sm font-semibold text-slate-800 truncate">{entry.name}</span>
        <span className="shrink-0 text-[11px] font-medium px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 ring-1 ring-violet-100">
          {t("admin_backup_items_count").replace("{count}", String(backups.length))}
        </span>
      </button>

      <div
        className={`grid transition-[grid-template-rows] duration-200 ease-in-out ${
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="overflow-hidden">
          {hasBackups && (
            <ul className="divide-y divide-slate-50 border-t border-slate-100 bg-slate-50/30">
              {backups.map((backup) => (
                <li key={backup.relativePath ?? backup.name} className="flex items-center gap-3 pl-12 pr-5 py-2.5 hover:bg-white/80">
                  <FaBoxArchive className="text-emerald-500 text-sm shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-slate-700 font-mono truncate">{backup.name}</p>
                    <p className="text-[10px] text-slate-400 mt-0.5">{t("admin_backup_snapshot")}</p>
                  </div>
                  <span className="shrink-0 text-xs text-slate-500 hidden sm:block">
                    {formatBackupDate(backup, lang)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </li>
  );
}
