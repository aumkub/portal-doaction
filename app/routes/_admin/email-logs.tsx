import { useState } from "react";
import { requireAdmin } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";
import { formatDate } from "~/lib/utils";
import { useT } from "~/lib/i18n";
import type { EmailLog } from "~/types";
import { parseClientCcEmails } from "~/lib/client-cc";
import Pagination from "~/components/ui/Pagination";
import type { IconType } from "react-icons";
import { FaBell, FaEnvelope, FaFileLines, FaKey, FaTicket, FaXmark } from "react-icons/fa6";

export function meta() {
  return [{ title: "Email Logs — Admin" }];
}

const PAGE_SIZE = 25;

// ── Email types ──────────────────────────────────────────────────────────────

type Category = "login" | "ticket" | "report" | "alert" | "other";

const CATEGORIES: Record<Category, { th: string; en: string; icon: IconType; chip: string; dot: string }> = {
  login: { th: "เข้าสู่ระบบ", en: "Sign-in", icon: FaKey, chip: "bg-sky-50 text-sky-700", dot: "bg-sky-500" },
  ticket: { th: "Ticket", en: "Tickets", icon: FaTicket, chip: "bg-[#FFF6C2] text-[#6B5B00]", dot: "bg-brand-yellow" },
  report: { th: "รายงาน", en: "Reports", icon: FaFileLines, chip: "bg-emerald-50 text-emerald-700", dot: "bg-emerald-500" },
  alert: { th: "แจ้งเตือนระบบ", en: "Alerts", icon: FaBell, chip: "bg-[#F1ECFF] text-[#5B3FB0]", dot: "bg-[#7C5CE0]" },
  other: { th: "อื่นๆ", en: "Other", icon: FaEnvelope, chip: "bg-paper text-ink-soft", dot: "bg-faint-ink" },
};

/** `source` written by each sender → its category and a readable name. */
const SOURCES: Record<string, { cat: Category; th: string; en: string }> = {
  login_magic_link: { cat: "login", th: "ลิงก์เข้าระบบ", en: "Magic link" },
  api_send_magic_link: { cat: "login", th: "ลิงก์เข้าระบบ", en: "Magic link" },
  admin_send_magic_link: { cat: "login", th: "แอดมินส่งลิงก์เข้าระบบ", en: "Magic link (by admin)" },
  admin_client_invite: { cat: "login", th: "เชิญลูกค้าใหม่", en: "Client invite" },
  ticket_reply_to_client: { cat: "ticket", th: "ทีมตอบลูกค้า", en: "Reply to client" },
  ticket_reply_to_admin: { cat: "ticket", th: "ลูกค้าตอบทีม", en: "Client replied" },
  ticket_closed_to_client: { cat: "ticket", th: "ปิด Ticket", en: "Ticket closed" },
  ticket_new_to_team: { cat: "ticket", th: "Ticket ใหม่", en: "New ticket" },
  ticket_rollup: { cat: "ticket", th: "สรุปข้อความ Ticket", en: "Message roll-up" },
  report_notify: { cat: "report", th: "ส่งรายงานประจำเดือน", en: "Monthly report" },
  daily_digest: { cat: "alert", th: "สรุปประจำวัน", en: "Daily digest" },
  contract_warning: { cat: "alert", th: "เตือนสัญญาใกล้หมด", en: "Contract warning" },
};

function sourceInfo(source: string | null) {
  return (source && SOURCES[source]) || { cat: "other" as Category, th: source ?? "—", en: source ?? "—" };
}

// ── Loader ───────────────────────────────────────────────────────────────────

export async function loader({ request, context }: any) {
  const env = context.cloudflare.env;
  await requireAdmin(request, env.DB, env.SESSIONPORTAL);
  const db = createDB(env.DB);
  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1"));
  const catParam = url.searchParams.get("cat");
  const cat = catParam && catParam in CATEGORIES ? (catParam as Category) : null;
  const failedOnly = url.searchParams.get("status") === "failed";

  // The list is a few thousand rows at most; html/text bodies stay for the preview.
  const all = await db.listEmailLogs(9999);
  const counts = { all: all.length } as Record<Category | "all", number>;
  for (const c of Object.keys(CATEGORIES) as Category[]) counts[c] = 0;
  let failed = 0;
  for (const l of all) {
    counts[sourceInfo(l.source).cat]++;
    if (l.status === "failed") failed++;
  }

  const filtered = all.filter(
    (l) => (!cat || sourceInfo(l.source).cat === cat) && (!failedOnly || l.status === "failed")
  );
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const logs = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  return { logs, page: safePage, totalPages, total: filtered.length, counts, failed, cat, failedOnly };
}

// ── Page ─────────────────────────────────────────────────────────────────────

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

function filterHref(cat: Category | null, failedOnly: boolean): string {
  const p = new URLSearchParams();
  if (cat) p.set("cat", cat);
  if (failedOnly) p.set("status", "failed");
  const qs = p.toString();
  return `/admin/email-logs${qs ? `?${qs}` : ""}`;
}

export default function AdminEmailLogsPage({ loaderData }: any) {
  const { logs, page, totalPages, total, counts, failed, cat, failedOnly } = loaderData as {
    logs: EmailLog[];
    page: number;
    totalPages: number;
    total: number;
    counts: Record<Category | "all", number>;
    failed: number;
    cat: Category | null;
    failedOnly: boolean;
  };
  const { lang, t } = useT();
  const L = (th: string, en: string) => (lang === "en" ? en : th);

  // Group the page's rows under day headings.
  const groups: { day: string; rows: EmailLog[] }[] = [];
  for (const l of logs) {
    const day = dayLabel(l.created_at, lang);
    const last = groups[groups.length - 1];
    if (last?.day === day) last.rows.push(l);
    else groups.push({ day, rows: [l] });
  }

  const extra = new URLSearchParams();
  if (cat) extra.set("cat", cat);
  if (failedOnly) extra.set("status", "failed");

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div>
        <p className="text-sm text-muted-ink">{t("admin_email_logs_title")}</p>
        <h1 className="mt-1.5 text-[28px] md:text-[32px] font-bold tracking-[-0.02em] text-ink">
          {failed > 0
            ? L(`ส่งไม่สำเร็จ ${failed} ฉบับ จากทั้งหมด ${counts.all}`, `${failed} of ${counts.all} emails failed`)
            : L(`ส่งอีเมลแล้ว ${counts.all} ฉบับ ไม่มีที่ล้มเหลว`, `${counts.all} emails sent, none failed`)}
        </h1>
      </div>

      {/* ── Type filter: one card per kind of email ── */}
      <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-5">
        <a
          href={filterHref(null, failedOnly)}
          aria-current={!cat ? "page" : undefined}
          className={`w-[148px] shrink-0 rounded-[18px] border p-4 transition-colors sm:w-auto sm:min-w-0 ${
            !cat ? "border-ink bg-ink text-white" : "border-line bg-white hover:border-ink/30"
          }`}
        >
          <span className={`text-[13px] font-semibold ${!cat ? "text-white" : "text-ink"}`}>{L("ทั้งหมด", "All")}</span>
          <span className="mt-2 block font-display text-[28px] leading-none font-bold tabular-nums">{counts.all}</span>
        </a>
        {(Object.keys(CATEGORIES) as Category[])
          .filter((c) => c !== "other" || counts.other > 0)
          .map((c) => {
            const info = CATEGORIES[c];
            const active = cat === c;
            return (
              <a
                key={c}
                href={filterHref(active ? null : c, failedOnly)}
                aria-current={active ? "page" : undefined}
                className={`w-[148px] shrink-0 rounded-[18px] border bg-white p-4 transition-colors sm:w-auto sm:min-w-0 ${
                  active ? "border-ink ring-1 ring-ink" : "border-line hover:border-ink/30"
                }`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] ${info.chip}`}>
                    <info.icon className="text-[12px]" aria-hidden="true" />
                  </span>
                  <span className="truncate text-[13px] font-semibold text-ink">{lang === "en" ? info.en : info.th}</span>
                </span>
                <span className="mt-2 block font-display text-[28px] leading-none font-bold tabular-nums text-ink">
                  {counts[c]}
                </span>
              </a>
            );
          })}
      </div>

      {/* ── List ── */}
      <section className="overflow-hidden rounded-[20px] border border-line bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-soft px-5 py-3.5">
          <p className="text-sm text-muted-ink">
            {cat ? (lang === "en" ? CATEGORIES[cat].en : CATEGORIES[cat].th) : L("ทุกประเภท", "All types")} ·{" "}
            {L(`${total} ฉบับ`, `${total} emails`)}
          </p>
          <div className="inline-flex rounded-full bg-paper p-[3px]">
            {[
              { v: false, label: L("ทั้งหมด", "All") },
              { v: true, label: L(`ไม่สำเร็จ (${failed})`, `Failed (${failed})`) },
            ].map((o) => (
              <a
                key={String(o.v)}
                href={filterHref(cat, o.v)}
                className={`flex h-8 items-center rounded-full px-3.5 text-[13px] font-medium ${
                  failedOnly === o.v ? "bg-white text-ink shadow-[0_1px_2px_rgba(0,0,0,0.08)]" : "text-muted-ink hover:text-ink"
                }`}
              >
                {o.label}
              </a>
            ))}
          </div>
        </div>

        {logs.length === 0 ? (
          <div className="px-5 py-14 text-center">
            <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-paper text-ink-soft">
              <FaEnvelope />
            </span>
            <p className="text-sm text-muted-ink">{t("admin_email_logs_empty")}</p>
          </div>
        ) : (
          groups.map((g) => (
            <div key={g.day}>
              <p className="sticky top-0 z-[1] border-b border-line-soft bg-paper/80 px-5 py-2 text-xs font-semibold text-muted-ink backdrop-blur">
                {g.day}
              </p>
              <ul className="divide-y divide-[#F4F2EC]">
                {g.rows.map((l) => {
                  const src = sourceInfo(l.source);
                  const info = CATEGORIES[src.cat];
                  const isFailed = l.status === "failed";
                  return (
                    <li key={l.id}>
                      <a
                        href={`/admin/email-logs/${l.id}`}
                        className="flex w-full min-w-0 items-center gap-3.5 px-5 py-3.5 text-left hover:bg-paper/60"
                      >
                        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] ${info.chip}`}>
                          <info.icon className="text-sm" aria-hidden="true" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-ink">{l.subject}</span>
                          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-ink">
                            <span className="shrink-0 font-medium text-ink-soft">{lang === "en" ? src.en : src.th}</span>
                            <span aria-hidden="true">·</span>
                            <span className="truncate">{l.to_email}</span>
                          </span>
                        </span>
                        <span className="flex shrink-0 flex-col items-end gap-1">
                          <span className="text-xs tabular-nums text-faint-ink">{timeLabel(l.created_at)}</span>
                          {isFailed && (
                            <span className="rounded-full bg-[#FDE7DA] px-2 py-0.5 text-[11px] font-semibold text-[#B4541A]">
                              {L("ไม่สำเร็จ", "Failed")}
                            </span>
                          )}
                        </span>
                      </a>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
        <Pagination page={page} totalPages={totalPages} extra={extra.toString() || undefined} />
      </section>
    </div>
  );
}
