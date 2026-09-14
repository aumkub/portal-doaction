import { requireAdmin } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";
import { createReportAccessToken } from "~/lib/report-access.server";
import { sendTelegramNotificationForClient } from "~/lib/telegram.server";

/** POST /api/report-telegram-notify — send (or resend) Telegram notification for a published report */
export async function action({ request, context }: any) {
  const env = context.cloudflare.env;
  await requireAdmin(request, env.DB, env.SESSIONPORTAL);

  if (request.method !== "POST") {
    return Response.json({ error: "method" }, { status: 405 });
  }

  const formData = await request.formData();
  const reportId = formData.get("reportId");
  if (typeof reportId !== "string" || !reportId) {
    return Response.json({ error: "missing_report" }, { status: 400 });
  }

  const db = createDB(env.DB);
  const report = await db.getReport(reportId);
  if (!report || report.status !== "published") {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const client = await db.getClientById(report.client_id);
  if (!client) return Response.json({ error: "no_client" }, { status: 400 });

  const appUrl = String(env.APP_URL || new URL(request.url).origin).replace(/\/$/, "");

  // Build a public report link with a fresh 14-day access token
  const user = await db.getUserById(client.user_id);
  let reportLink = `${appUrl}/admin/reports/${report.id}`;
  if (user?.email) {
    const secret = env.SESSION_SECRET || "doaction-report-link-secret";
    const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 14;
    const token = await createReportAccessToken(
      { reportId: report.id, email: user.email.toLowerCase(), exp },
      secret
    );
    reportLink = `${appUrl}/public/report/${report.id}?t=${encodeURIComponent(token)}`;
  }

  await sendTelegramNotificationForClient({
    db,
    appUrl,
    clientId: report.client_id,
    notification: {
      title: `📊 รายงานประจำเดือน: ${client.company_name}`,
      body: report.title,
      link: reportLink,
    },
  });

  const now = Math.floor(Date.now() / 1000);
  await db.updateReport(report.id, { telegram_notified_at: now });

  return Response.json({ ok: true, notifiedAt: now });
}
