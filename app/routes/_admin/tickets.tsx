import type { Route } from "./+types/tickets";
import { useState, useMemo } from "react";
import { requireCoAdminOrAdmin } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";
import { formatDate } from "~/lib/utils";
import { useT } from "~/lib/i18n";
import type { TranslationKey } from "~/lib/translations";
import type { SupportTicket } from "~/types";
import type { IconType } from "react-icons";
import { FaCircleCheck, FaCircleDot, FaClock, FaHourglassHalf, FaLock, FaMagnifyingGlass, FaSpinner, FaTicket, FaTrash } from "react-icons/fa6";

export function meta() {
  return [{ title: "จัดการ Tickets — Admin" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const user = await requireCoAdminOrAdmin(request, env.DB, env.SESSIONPORTAL);
  const db = createDB(env.DB);

  let assignedClientIds: string[] | undefined;
  if (user.role === "co-admin") {
    const assignments = await db.listCoAdminClients(user.id);
    assignedClientIds = assignments.map((a) => a.client_id);
  }

  const allTickets = await db.listTicketsWithClient(assignedClientIds);

  const counts: Record<string, number> = { all: allTickets.length };
  for (const t of allTickets) {
    counts[t.status] = (counts[t.status] ?? 0) + 1;
  }

  return { tickets: allTickets, counts, userRole: user.role };
}

type Status = SupportTicket["status"];

const STATUSES: Record<Status, { key: TranslationKey; icon: IconType; chip: string; pill: string }> = {
  open:        { key: "status_open",         icon: FaCircleDot,     chip: "bg-[#FDE7DA] text-[#B4541A]",     pill: "bg-[#FDE7DA] text-[#B4541A]" },
  in_progress: { key: "status_in_progress",  icon: FaSpinner,       chip: "bg-sky-50 text-sky-700",          pill: "bg-sky-50 text-sky-700" },
  waiting:     { key: "status_waiting",      icon: FaHourglassHalf, chip: "bg-[#FFF6C2] text-[#6B5B00]",     pill: "bg-[#FFF6C2] text-[#6B5B00]" },
  resolved:    { key: "status_resolved",     icon: FaCircleCheck,   chip: "bg-emerald-50 text-emerald-700",  pill: "bg-emerald-50 text-emerald-700" },
  closed:      { key: "status_closed_short", icon: FaLock,          chip: "bg-paper text-ink-soft",          pill: "bg-ink text-white" },
};

const STATUS_ORDER: Status[] = ["open", "in_progress", "waiting", "resolved", "closed"];

const priorityKey: Record<SupportTicket["priority"], TranslationKey> = {
  low: "priority_low",
  medium: "priority_medium",
  high: "priority_high",
  urgent: "priority_urgent",
};

const priorityClass: Record<SupportTicket["priority"], string> = {
  low: "text-muted-ink",
  medium: "text-muted-ink",
  high: "font-semibold text-[#6B5B00]",
  urgent: "font-semibold text-[#B4541A]",
};

function getInitials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

function dayLabel(unix: number, lang: "th" | "en"): string {
  const bkk = (s: number) => new Date((s + 7 * 3600) * 1000).toISOString().slice(0, 10);
  const today = bkk(Math.floor(Date.now() / 1000));
  const yesterday = bkk(Math.floor(Date.now() / 1000) - 86400);
  const d = bkk(unix);
  if (d === today) return lang === "en" ? "Today" : "วันนี้";
  if (d === yesterday) return lang === "en" ? "Yesterday" : "เมื่อวาน";
  return formatDate(unix, lang);
}

function timeLabel(unix: number): string {
  return new Date((unix + 7 * 3600) * 1000).toISOString().slice(11, 16);
}

function ageLabel(seconds: number, lang: "th" | "en"): string {
  const h = Math.floor(seconds / 3600);
  if (h < 48) return lang === "en" ? `${h}h` : `${h} ชม.`;
  const d = Math.floor(h / 24);
  return lang === "en" ? `${d}d` : `${d} วัน`;
}

type Ticket = SupportTicket & { company_name: string };

export default function AdminTicketsPage({ loaderData }: Route.ComponentProps) {
  const { tickets, counts } = loaderData as {
    tickets: Ticket[];
    counts: Record<string, number>;
  };
  const { t, lang } = useT();
  const L = (th: string, en: string) => (lang === "en" ? en : th);
  // Resolved and closed tickets are history; show only the open work unless
  // a status card asks for more.
  const [filter, setFilter] = useState<Status | "active" | "all">("active");
  const isActiveStatus = (st: string) => st === "open" || st === "in_progress" || st === "waiting";
  const activeCount = tickets.filter((tick) => isActiveStatus(tick.status)).length;
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return tickets
      .filter((tick) => {
        const matchesStatus =
          filter === "all" || (filter === "active" ? isActiveStatus(tick.status) : tick.status === filter);
        const matchesSearch =
          !q || tick.title.toLowerCase().includes(q) || tick.company_name.toLowerCase().includes(q);
        return matchesStatus && matchesSearch;
      })
      .sort((a, b) => b.updated_at - a.updated_at);
  }, [tickets, filter, search]);

  const groups: { day: string; rows: Ticket[] }[] = [];
  for (const tick of filtered) {
    const day = dayLabel(tick.updated_at, lang);
    const last = groups[groups.length - 1];
    if (last?.day === day) last.rows.push(tick);
    else groups.push({ day, rows: [tick] });
  }

  const now = Math.floor(Date.now() / 1000);
  const unresolved = (counts.open ?? 0) + (counts.in_progress ?? 0);
  const stale = tickets.filter(
    (tk) => (tk.status === "open" || tk.status === "in_progress") && now - tk.updated_at > 86400
  ).length;

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm text-muted-ink">
            {t("admin_tickets_page_title")} · {t("admin_tickets_page_subtitle").replace("{count}", String(counts.all ?? 0))}
          </p>
          <h1 className="mt-1.5 text-[28px] md:text-[32px] font-bold tracking-[-0.02em] text-ink">
            {unresolved > 0
              ? L(`${unresolved} เรื่องรอทีมตอบ`, `${unresolved} tickets waiting on the team`)
              : L("ไม่มีเรื่องค้าง", "Nothing outstanding")}
          </h1>
          {stale > 0 && (
            <p className="mt-1 text-sm text-[#B4541A]">
              {L(`${stale} เรื่องไม่มีความเคลื่อนไหวเกิน 24 ชม.`, `${stale} untouched for over 24h`)}
            </p>
          )}
        </div>
        <a
          href="/admin/tickets/trash"
          className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border border-line bg-white px-5 text-[13px] font-semibold text-ink-soft hover:bg-paper transition-colors"
        >
          <FaTrash className="text-[10px] text-faint-ink" />
          ถังขยะ
        </a>
      </div>

      {/* ── Status cards (filters) ── */}
      <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-4 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-7">
        <button
          type="button"
          onClick={() => setFilter("active")}
          aria-pressed={filter === "active"}
          className={`w-[148px] shrink-0 rounded-[18px] border p-4 text-left transition-colors sm:w-auto sm:min-w-0 ${
            filter === "active" ? "border-ink bg-ink text-white" : "border-line bg-white hover:border-ink/30"
          }`}
        >
          <span className={`text-[13px] font-semibold ${filter === "active" ? "text-white" : "text-ink"}`}>{L("ค้างอยู่", "Open work")}</span>
          <span className="mt-2 block font-display text-[28px] leading-none font-bold tabular-nums">{activeCount}</span>
        </button>
        {STATUS_ORDER.map((s) => {
          const info = STATUSES[s];
          const active = filter === s;
          return (
            <button
              key={s}
              type="button"
              onClick={() => setFilter(active ? "active" : s)}
              aria-pressed={active}
              className={`w-[148px] shrink-0 rounded-[18px] border bg-white p-4 text-left transition-colors sm:w-auto sm:min-w-0 ${
                active ? "border-ink ring-1 ring-ink" : "border-line hover:border-ink/30"
              }`}
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] ${info.chip}`}>
                  <info.icon className="text-[12px]" aria-hidden="true" />
                </span>
                <span className="truncate text-[13px] font-semibold text-ink">{t(info.key)}</span>
              </span>
              <span className="mt-2 block font-display text-[28px] leading-none font-bold tabular-nums text-ink">
                {counts[s] ?? 0}
              </span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setFilter(filter === "all" ? "active" : "all")}
          aria-pressed={filter === "all"}
          className={`w-[148px] shrink-0 rounded-[18px] border bg-white p-4 text-left transition-colors sm:w-auto sm:min-w-0 ${
            filter === "all" ? "border-ink ring-1 ring-ink" : "border-line hover:border-ink/30"
          }`}
        >
          <span className="text-[13px] font-semibold text-ink">{L("ทั้งหมด", "All")}</span>
          <span className="mt-2 block font-display text-[28px] leading-none font-bold tabular-nums text-ink">{counts.all ?? 0}</span>
        </button>
      </div>

      {/* ── List ── */}
      <section className="overflow-hidden rounded-[20px] border border-line bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-soft px-5 py-3.5">
          <p className="text-sm text-muted-ink">
            {filter === "all"
              ? L("ทุกสถานะ", "All statuses")
              : filter === "active"
                ? L("ค้างอยู่ (ซ่อนที่แก้แล้วและปิดแล้ว)", "Open work (resolved & closed hidden)")
                : t(STATUSES[filter].key)}{" "}
            ·{" "}
            {L(`${filtered.length} เรื่อง`, `${filtered.length} tickets`)}
          </p>
          <div className="relative w-full sm:w-60">
            <FaMagnifyingGlass className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-xs text-muted-ink" />
            <input
              type="search"
              placeholder="ค้นหา..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 w-full rounded-full border border-line bg-white pl-9 pr-3 text-sm placeholder:text-faint-ink focus:border-ink/40 focus:outline-none focus:ring-2 focus:ring-ink/10"
            />
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="px-5 py-14 text-center">
            <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-paper text-ink-soft">
              <FaTicket />
            </span>
            <p className="text-sm text-muted-ink">
              {search
                ? "ไม่พบ Ticket ที่ค้นหา"
                : filter === "active"
                  ? "ไม่มีเรื่องค้าง — ดูเรื่องที่แก้แล้วหรือปิดแล้วได้จากการ์ดด้านบน"
                  : t("admin_tickets_empty")}
            </p>
          </div>
        ) : (
          groups.map((g) => (
            <div key={g.day}>
              <p className="sticky top-0 z-[1] border-b border-line-soft bg-paper/80 px-5 py-2 text-xs font-semibold text-muted-ink backdrop-blur">
                {g.day}
              </p>
              <ul className="divide-y divide-[#F4F2EC]">
                {g.rows.map((tick) => {
                  const st = STATUSES[tick.status] ?? STATUSES.closed;
                  const age = now - tick.updated_at;
                  const isStale = (tick.status === "open" || tick.status === "in_progress") && age > 86400;
                  return (
                    <li key={tick.id}>
                      <a
                        href={`/admin/tickets/${tick.id}`}
                        className={`flex w-full min-w-0 items-center gap-3.5 px-5 py-3.5 hover:bg-paper/60 ${isStale ? "bg-[#FFF8F3]" : ""}`}
                      >
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] bg-paper text-xs font-bold text-ink-soft">
                          {getInitials(tick.company_name)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-ink">{tick.title}</span>
                          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-ink">
                            <span className="truncate">{tick.company_name}</span>
                            <span aria-hidden="true">·</span>
                            <span className={`shrink-0 ${priorityClass[tick.priority]}`}>{t(priorityKey[tick.priority])}</span>
                          </span>
                        </span>
                        <span className="flex shrink-0 flex-col items-end gap-1">
                          <span className="flex items-center gap-1.5">
                            {isStale && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-[#FDE7DA] px-2 py-0.5 text-[11px] font-semibold text-[#B4541A]">
                                <FaClock className="text-[9px]" aria-hidden="true" />
                                {ageLabel(age, lang)}
                              </span>
                            )}
                            <span className="text-xs tabular-nums text-faint-ink">{timeLabel(tick.updated_at)}</span>
                          </span>
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${st.pill}`}>{t(st.key)}</span>
                        </span>
                      </a>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
