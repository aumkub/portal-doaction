import type { DB } from "~/lib/db.server";
import { sendEmail } from "~/lib/email.server";
import { buildReportCustomerNotification } from "~/lib/report-customer-email.server";
import { createReportAccessToken } from "~/lib/report-access.server";
import { parseClientCcEmails } from "~/lib/client-cc";
import { sendTelegramNotificationForClient } from "~/lib/telegram.server";

export type ReportNotifyResult =
  | { ok: true; notifiedAt: number; to: string }
  | { ok: false; error: string; status: number; message?: string };

/**
 * Email a published report to its client (with CCs), then ping the client's
 * co-admin Telegram groups. Shared by the admin UI and the MCP server.
 */
export async function notifyReportToClient(params: {
  env: CloudflareEnv;
  db: DB;
  reportId: string;
  origin: string;
}): Promise<ReportNotifyResult> {
  const { env, db, reportId } = params;
  if (!env.SEND_EMAIL) return { ok: false, error: "email_not_configured", status: 503 };

  const report = await db.getReport(reportId);
  if (!report || report.status !== "published") {
    return { ok: false, error: "not_found", status: 404 };
  }

  const client = await db.getClientById(report.client_id);
  if (!client) return { ok: false, error: "no_client", status: 400 };

  const user = await db.getUserById(client.user_id);
  if (!user?.email) return { ok: false, error: "no_email", status: 400 };

  const origin = String(env.APP_URL || params.origin).replace(/\/$/, "");
  const secret = env.SESSION_SECRET || "doaction-report-link-secret";
  const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 14; // 14 days
  const token = await createReportAccessToken(
    { reportId: report.id, email: user.email.toLowerCase(), exp },
    secret
  );
  const reportUrl = `${origin}/public/report/${report.id}?t=${encodeURIComponent(token)}`;

  const { subject, html, text } = buildReportCustomerNotification({
    companyName: client.company_name,
    contactName: user.name,
    reportTitle: report.title,
    year: report.year,
    month: report.month,
    summary: report.summary,
    reportUrl,
    lang: user.language === "en" ? "en" : "th",
  });
  const ccRecipients = parseClientCcEmails(client.cc_emails).map((email) => ({ email }));

  try {
    await sendEmail({
      to: user.email,
      toName: user.name,
      cc: ccRecipients,
      subject,
      html,
      text,
      sendEmail: env.SEND_EMAIL,
      db,
      source: "report_notify",
    });
  } catch (e) {
    console.error("[report-notify]", e);
    return {
      ok: false,
      error: "send_failed",
      status: 502,
      message: e instanceof Error ? e.message : String(e),
    };
  }

  const now = Math.floor(Date.now() / 1000);
  await db.updateReport(report.id, {
    client_notified_at: now,
    client_notification_subject: subject,
    client_notification_html: html,
  });

  // Send Telegram notification to co-admin groups for this client
  await sendTelegramNotificationForClient({
    db,
    appUrl: origin,
    clientId: report.client_id,
    notification: {
      title: `📊 ส่งรายงานให้ลูกค้าแล้ว: ${client.company_name}`,
      body: report.title,
      link: `/admin/reports/${report.id}`,
    },
  });
  await db.updateReport(report.id, { telegram_notified_at: now });

  return { ok: true, notifiedAt: now, to: user.email };
}
