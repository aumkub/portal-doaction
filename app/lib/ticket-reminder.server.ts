import { createDB } from "~/lib/db.server";
import { sendTelegramNotification } from "~/lib/telegram.server";

const STATUS_EMOJI: Record<string, string> = {
  open: "🔴",
  in_progress: "🟡",
  waiting: "🔵",
};

const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  in_progress: "In Progress",
  waiting: "Waiting",
};

export async function runTicketReminder(env: CloudflareEnv): Promise<void> {
  const db = createDB(env.DB);

  // Check enabled
  const enabled = await db.getAppSetting("ticket_reminder_enabled");
  if (enabled === "0") return;

  // Check hour — Bangkok time = UTC+7
  const configuredHour = Number((await db.getAppSetting("ticket_reminder_hour")) ?? "9");
  const nowUtc = new Date();
  const bangkokHour = (nowUtc.getUTCHours() + 7) % 24;
  if (bangkokHour !== configuredHour) return;

  // Check frequency (must be at least N days since last send, with 1-hour tolerance)
  const frequencyDays = Number((await db.getAppSetting("ticket_reminder_days")) ?? "1");
  const lastSentRaw = await db.getAppSetting("ticket_reminder_last_sent");
  const lastSent = lastSentRaw ? Number(lastSentRaw) : 0;
  const nowSec = Math.floor(Date.now() / 1000);
  const minGap = frequencyDays * 86400 - 3600; // subtract 1h to tolerate cron drift
  if (nowSec - lastSent < minGap) return;

  // Query open tickets
  const tickets = await db.listAllOpenTickets();
  if (tickets.length === 0) return;

  // Build message body grouped by status
  const groups = ["open", "in_progress", "waiting"] as const;
  const bodyLines: string[] = [];
  for (const status of groups) {
    const group = tickets.filter((t) => t.status === status);
    if (group.length === 0) continue;
    bodyLines.push(`${STATUS_EMOJI[status]} ${STATUS_LABEL[status]} (${group.length})`);
    const shown = group.slice(0, 10);
    for (const t of shown) {
      bodyLines.push(`  • [${t.company_name}] ${t.title}`);
    }
    if (group.length > 10) {
      bodyLines.push(`  … and ${group.length - 10} more`);
    }
  }

  await sendTelegramNotification({
    db,
    appUrl: env.APP_URL,
    notification: {
      title: `🎫 ${tickets.length} ticket${tickets.length > 1 ? "s" : ""} still open`,
      body: bodyLines.join("\n"),
      link: "/admin/tickets",
    },
  });

  await db.setAppSetting("ticket_reminder_last_sent", String(nowSec));
}
