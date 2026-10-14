import { createDB, type DB } from "~/lib/db.server";
import { sendEmail } from "~/lib/email.server";
import { parseClientCcEmails } from "~/lib/client-cc";
import { bangkokToday, isContractExpired, needsMonthlyReport } from "~/lib/contract";
import { generateId } from "~/lib/utils";

/**
 * Low-volume email alerts. Everything here exists to send FEWER emails:
 *  - ticket emails are throttled per ticket and rolled up,
 *  - the team gets one daily digest instead of one email per event,
 *  - contract warnings go out once per stage, from the cron.
 */

// ── Throttled ticket emails ─────────────────────────────────────────────────

/**
 * Window after an email during which further ones for the same ticket are
 * held. Shorter for the team: a client follow-up may be the urgent part.
 */
const THROTTLE_SECONDS: Record<PendingTicketEmail["audience"], number> = {
  client: 30 * 60,
  team: 10 * 60,
};

/** How much of the latest message a roll-up email quotes. */
const EXCERPT_CHARS = 300;

interface PendingTicketEmail {
  to: string;
  toName?: string;
  cc: Array<{ email: string }>;
  ticketTitle: string;
  ticketUrl: string;
  lang: "th" | "en";
  /** "client" = team replied to the client; "team" = client replied to us. */
  audience: "client" | "team";
  /** Start of the most recent held message, quoted in the roll-up. */
  lastMessage?: string;
  count: number;
  lastAt: number;
}

export type TicketEmailTarget = Omit<PendingTicketEmail, "count" | "lastAt">;

/**
 * Send now if nothing went out for this ticket+audience recently; otherwise
 * hold it and let `flushHeldTicketEmails` send one "N new messages" email.
 * Urgent tickets are never held.
 */
export async function sendOrHoldTicketEmail(
  env: CloudflareEnv,
  ticketId: string,
  target: TicketEmailTarget,
  sendNow: () => Promise<void>,
  opts: { urgent?: boolean } = {}
): Promise<"sent" | "held"> {
  const kv = env.SESSIONPORTAL;
  const base = `tmail:${target.audience}:${ticketId}`;
  // KV rejects TTLs under 60s; the windows are well above that.
  const ttl = THROTTLE_SECONDS[target.audience];
  if (opts.urgent || !(await kv.get(`${base}:sent`))) {
    await sendNow();
    await kv.put(`${base}:sent`, "1", { expirationTtl: ttl });
    return "sent";
  }
  const pending = await kv.get<PendingTicketEmail>(`${base}:held`, "json");
  const next: PendingTicketEmail = {
    ...target,
    lastMessage: target.lastMessage?.slice(0, EXCERPT_CHARS),
    count: (pending?.count ?? 0) + 1,
    lastAt: Math.floor(Date.now() / 1000),
  };
  // Held entries expire on their own if the cron never gets to them.
  await kv.put(`${base}:held`, JSON.stringify(next), { expirationTtl: 3 * 86400 });
  return "held";
}

/** Cron: send one roll-up per ticket once its conversation has gone quiet. */
export async function flushHeldTicketEmails(env: CloudflareEnv): Promise<void> {
  if (!env.SEND_EMAIL) return;
  const db = createDB(env.DB);
  const kv = env.SESSIONPORTAL;
  const now = Math.floor(Date.now() / 1000);
  const { keys } = await kv.list({ prefix: "tmail:" });
  for (const { name } of keys) {
    if (!name.endsWith(":held")) continue;
    const held = await kv.get<PendingTicketEmail>(name, "json");
    if (!held) continue;
    const window = THROTTLE_SECONDS[held.audience];
    if (now - held.lastAt < window) continue; // still active, wait

    const th = held.lang === "th";
    const subject = held.audience === "client"
      ? (th ? `มีข้อความใหม่ ${held.count} ข้อความใน Ticket: ${held.ticketTitle}` : `${held.count} new messages in ticket: ${held.ticketTitle}`)
      : `ลูกค้าตอบ Ticket เพิ่ม ${held.count} ข้อความ: ${held.ticketTitle}`;
    const line = held.audience === "client"
      ? (th ? `ทีม do action ตอบกลับเพิ่ม ${held.count} ข้อความ` : `The do action team sent ${held.count} more messages`)
      : `ลูกค้าตอบเพิ่ม ${held.count} ข้อความ`;
    const openLabel = th ? "เปิด Ticket" : "Open ticket";
    const latestLabel = th ? "ข้อความล่าสุด" : "Latest message";
    const excerpt = held.lastMessage
      ? held.lastMessage + (held.lastMessage.length >= EXCERPT_CHARS ? "…" : "")
      : "";

    try {
      await sendEmail({
        to: held.to,
        toName: held.toName,
        cc: held.cc,
        subject,
        text: `${line}${excerpt ? `\n\n${latestLabel}:\n${excerpt}` : ""}\n\n${openLabel}: ${held.ticketUrl}\n\n— do action`,
        html: emailShell(
          `<p>${escapeHtml(line)}</p>${excerpt ? quote(latestLabel, excerpt) : ""}${button(openLabel, held.ticketUrl)}`,
          env.APP_URL
        ),
        sendEmail: env.SEND_EMAIL,
        db,
        source: "ticket_rollup",
      });
      await kv.delete(name);
      await kv.put(name.replace(/:held$/, ":sent"), "1", { expirationTtl: window });
    } catch (e) {
      console.error("[email-alerts] rollup failed", e);
    }
  }
}

// ── New ticket → team ───────────────────────────────────────────────────────

/**
 * A new ticket is news nobody on the team has seen yet, so it always emails
 * right away: one message to the first admin, the rest on CC.
 */
export async function emailTeamNewTicket(
  env: CloudflareEnv,
  db: DB,
  ticket: { id: string; title: string; description: string; priority: string },
  clientName: string
): Promise<void> {
  if (!env.SEND_EMAIL) return;
  const admins = (await db.listAdminUsers()).filter((a) => a.email);
  if (admins.length === 0) return;
  const [first, ...rest] = admins;
  const url = `${env.APP_URL}/admin/tickets/${ticket.id}`;
  const urgent = ticket.priority === "urgent" || ticket.priority === "high";
  const tag = ticket.priority === "urgent" ? "[ด่วนมาก] " : ticket.priority === "high" ? "[ด่วน] " : "";
  const excerpt = ticket.description.slice(0, EXCERPT_CHARS) + (ticket.description.length > EXCERPT_CHARS ? "…" : "");
  await sendEmail({
    to: first.email,
    toName: first.name,
    cc: rest.map((a) => ({ email: a.email, name: a.name })),
    subject: `${tag}Ticket ใหม่จาก ${clientName}: ${ticket.title}`,
    text: `${clientName} เปิด Ticket ใหม่${urgent ? ` (ความสำคัญ: ${ticket.priority})` : ""}\n\n${ticket.title}\n\n${excerpt}\n\nเปิด Ticket: ${url}`,
    html: emailShell(
      `<p style="margin:0">${escapeHtml(clientName)} เปิด Ticket ใหม่</p><h2 style="margin:8px 0 0;font-size:18px">${escapeHtml(tag + ticket.title)}</h2>${quote("รายละเอียด", excerpt)}${button("เปิด Ticket", url)}`,
      env.APP_URL
    ),
    sendEmail: env.SEND_EMAIL,
    db,
    source: "ticket_new_to_team",
  });
}

// ── Daily team digest + contract warnings ───────────────────────────────────

const DEFAULT_DIGEST_HOUR = 8; // Bangkok time

/**
 * Cron: once a day at the configured Bangkok hour, email contract-expiry
 * warnings to clients and one digest to the team. Skips when there is
 * nothing to say.
 */
export async function runDailyEmailAlerts(env: CloudflareEnv): Promise<void> {
  if (!env.SEND_EMAIL) return;
  const db = createDB(env.DB);
  const s = await db.getAppSettings([
    "email_digest_enabled",
    "email_digest_hour",
    "email_digest_last_date",
    "contract_warning_first_days",
    "contract_warning_second_days",
    "contract_warning_third_days",
  ]);
  if (s.email_digest_enabled === "0") return;

  const hour = Number(s.email_digest_hour ?? DEFAULT_DIGEST_HOUR);
  const bangkokHour = (new Date().getUTCHours() + 7) % 24;
  const today = bangkokToday();
  if (bangkokHour !== hour || s.email_digest_last_date === today) return;
  // Claim the day first so overlapping cron runs cannot double-send.
  await db.setAppSetting("email_digest_last_date", today);

  const warnDays = [
    { stage: "first" as const, days: Number(s.contract_warning_first_days ?? "14") },
    { stage: "second" as const, days: Number(s.contract_warning_second_days ?? "7") },
    { stage: "third" as const, days: Number(s.contract_warning_third_days ?? "1") },
  ].filter((w) => Number.isFinite(w.days) && w.days > 0);

  const clients = (await db.listClients()).filter((c) => !isContractExpired(c.contract_end));
  const expiring: Array<{ name: string; end: string; days: number }> = [];
  for (const client of clients) {
    if (!client.contract_end) continue;
    const days = daysUntil(client.contract_end, today);
    if (days <= 30) expiring.push({ name: client.company_name, end: client.contract_end, days });
    const warn = warnDays.find((w) => w.days === days);
    if (!warn) continue;
    if (await db.hasContractWarningLog(client.id, warn.stage, client.contract_end)) continue;
    await warnClientContract(env, db, client, days);
    await db.createContractWarningLog({
      id: generateId(),
      client_id: client.id,
      warning_stage: warn.stage,
      contract_end: client.contract_end,
    });
  }

  await sendTeamDigest(env, db, clients, expiring);
}

/**
 * Send today's digest right now to one admin, ignoring the schedule and the
 * once-a-day guard. Used by the settings page's "send test" button. Returns
 * false when there is nothing to report.
 */
export async function sendDigestPreview(
  env: CloudflareEnv,
  to: { email: string; name: string }
): Promise<boolean> {
  if (!env.SEND_EMAIL) return false;
  const db = createDB(env.DB);
  const today = bangkokToday();
  const clients = (await db.listClients()).filter((c) => !isContractExpired(c.contract_end));
  const expiring = clients
    .filter((c) => c.contract_end && daysUntil(c.contract_end, today) <= 30)
    .map((c) => ({ name: c.company_name, end: c.contract_end!, days: daysUntil(c.contract_end!, today) }));
  return sendTeamDigest(env, db, clients, expiring, [to]);
}

async function warnClientContract(
  env: CloudflareEnv,
  db: DB,
  client: { id: string; user_id: string; company_name: string; contract_end: string | null; cc_emails: string | null },
  days: number
) {
  const user = await db.getUserById(client.user_id);
  const body = `สัญญาบริการของคุณจะหมดอายุในอีก ${days} วัน (${client.contract_end}) กรุณาติดต่อทีมงานเพื่อต่ออายุ`;
  await db.createNotification({
    id: generateId(),
    user_id: client.user_id,
    type: "contract_expiry_warning",
    title: "แจ้งเตือนวันหมดอายุสัญญา",
    body,
    link: "/settings",
    read: 0,
  });
  if (!user?.email) return;
  const url = `${env.APP_URL}/settings`;
  await sendEmail({
    to: user.email,
    toName: user.name,
    cc: parseClientCcEmails(client.cc_emails).map((email) => ({ email })),
    subject: `สัญญาบริการ ${client.company_name} จะหมดอายุในอีก ${days} วัน`,
    text: `สวัสดีคุณ ${user.name}\n\n${body}\n\nดูรายละเอียด: ${url}\n\n— do action`,
    html: emailShell(`<p>สวัสดีคุณ ${escapeHtml(user.name)}</p><p>${escapeHtml(body)}</p>${button("ดูรายละเอียดสัญญา", url)}`, env.APP_URL),
    sendEmail: env.SEND_EMAIL,
    db,
    source: "contract_warning",
  });
}

async function sendTeamDigest(
  env: CloudflareEnv,
  db: DB,
  activeClients: Array<{ id: string; company_name: string }>,
  expiring: Array<{ name: string; end: string; days: number }>,
  recipients?: Array<{ email: string; name: string }>
): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  const [open, recentReports] = await Promise.all([
    db.listAllOpenTickets(),
    db.listRecentReportsWithClient(1),
  ]);
  const activeIds = new Set(
    activeClients.filter((c) => needsMonthlyReport({ ...c, contract_end: null })).map((c) => c.id)
  );
  const [y, m] = bangkokToday().split("-").map(Number);
  const missing = await db.listClientsWithoutReportForMonth(y, m);
  const unsent = recentReports.filter(
    (r) => r.year === y && r.month === m && activeIds.has(r.client_id) && r.status === "published" && !r.client_notified_at
  );
  // Reports only matter from the 20th; before that "not created yet" is normal.
  const showMissing = Number(bangkokToday().slice(8, 10)) >= 20;

  const sections: string[] = [];
  const textLines: string[] = [];
  const add = (title: string, rows: string[]) => {
    if (rows.length === 0) return;
    sections.push(`<h3 style="margin:20px 0 6px;font-size:15px">${escapeHtml(title)}</h3><ul style="margin:0;padding-left:18px;line-height:1.7">${rows.map((r) => `<li>${escapeHtml(r)}</li>`).join("")}</ul>`);
    textLines.push(`\n${title}`, ...rows.map((r) => `• ${r}`));
  };
  add(
    `Ticket ค้าง ${open.length} เรื่อง`,
    open
      .sort((a, b) => a.updated_at - b.updated_at)
      .slice(0, 15)
      .map((t) => `[${t.company_name}] ${t.title} — ${ageLabel(now - t.updated_at)}`)
  );
  add(`รายงานที่เผยแพร่แล้วแต่ยังไม่ส่งอีเมล`, unsent.map((r) => `${r.company_name} — ${r.title}`));
  if (showMissing) add(`ยังไม่สร้างรายงานเดือนนี้ (${missing.length} ราย)`, missing.map((c) => c.company_name));
  add(`สัญญาจะหมดใน 30 วัน`, expiring.sort((a, b) => a.days - b.days).map((e) => `${e.name} — ${e.end} (อีก ${e.days} วัน)`));

  if (sections.length === 0) return false; // nothing worth an email today

  const admins = recipients ?? (await db.listAdminUsers()).filter((a) => a.email);
  if (admins.length === 0) return false;
  const [first, ...rest] = admins;
  const url = `${env.APP_URL}/admin`;
  await sendEmail({
    to: first.email,
    toName: first.name,
    cc: rest.map((a) => ({ email: a.email, name: a.name })),
    subject: `สรุปประจำวัน do action portal — ${bangkokToday()}`,
    text: `สรุปประจำวัน${textLines.join("\n")}\n\nเปิด portal: ${url}`,
    html: emailShell(`<p style="margin:0">สรุปสิ่งที่ต้องดูวันนี้</p>${sections.join("")}${button("เปิด portal", url)}`, env.APP_URL),
    sendEmail: env.SEND_EMAIL,
    db,
    source: "daily_digest",
  });
  return true;
}

// ── helpers ─────────────────────────────────────────────────────────────────

function daysUntil(date: string, today: string): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
}

function ageLabel(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  return h >= 24 ? `รอ ${Math.floor(h / 24)} วัน` : `รอ ${h} ชม.`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function quote(label: string, text: string): string {
  return `<p style="margin:16px 0 6px;font-size:12px;color:#6F6D66">${escapeHtml(label)}</p><div style="background:#F6F5F1;border-radius:12px;padding:12px 14px;white-space:pre-wrap;font-size:14px;line-height:1.6">${escapeHtml(text)}</div>`;
}

function button(label: string, href: string): string {
  return `<p style="margin:24px 0 0"><a href="${escapeHtml(href)}" style="display:inline-block;background:#111111;color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:999px;font-weight:600">${escapeHtml(label)}</a></p>`;
}

function emailShell(inner: string, appUrl?: string): string {
  // PNG, not SVG: Gmail and Outlook do not render SVG images.
  const logo = appUrl
    ? `<img src="${escapeHtml(appUrl)}/logo-black.png" alt="do action" width="220" style="display:block;height:auto;border:0;margin:0 0 20px" />`
    : "";
  return `<!doctype html><html><body style="margin:0;background:#F6F5F1;font-family:system-ui,sans-serif;color:#111111"><div style="max-width:560px;margin:0 auto;padding:32px 24px">${logo}<div style="background:#ffffff;border:1px solid #E6E3DA;border-radius:20px;padding:28px">${inner}</div><p style="font-size:12px;color:#8A887F;margin:16px 0 0">do action client portal</p></div></body></html>`;
}
