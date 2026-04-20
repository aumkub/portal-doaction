import type { Route } from "./+types/report-notify";
import { requireAdmin } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";
import { sendEmail } from "~/lib/email.server";
import { buildReportCustomerNotification } from "~/lib/report-customer-email.server";
import { createReportAccessToken } from "~/lib/report-access.server";
import { parseClientCcEmails } from "~/lib/client-cc";

/** POST /api/report-notify — send report notification email to client user */
export async function action({ request, context }: Route.ActionArgs) {
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

  const apiKey = env.SMTP2GO_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "email_not_configured" }, { status: 503 });
  }

  const db = createDB(env.DB);
  const report = await db.getReport(reportId);
  if (!report || report.status !== "published") {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const client = await db.getClientById(report.client_id);
  if (!client) return Response.json({ error: "no_client" }, { status: 400 });

  const user = await db.getUserById(client.user_id);
  if (!user?.email) return Response.json({ error: "no_email" }, { status: 400 });

  const origin = env.APP_URL || new URL(request.url).origin;
  const secret = env.SESSION_SECRET || "doaction-report-link-secret";
  const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 14; // 14 days
  const token = await createReportAccessToken(
    { reportId: report.id, email: user.email.toLowerCase(), exp },
    secret
  );
  const reportUrl = `${String(origin).replace(/\/$/, "")}/public/report/${report.id}?t=${encodeURIComponent(token)}`;

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
      apiKey,
      db,
      source: "report_notify",
    });
  } catch (e) {
    console.error("[report-notify]", e);
    return Response.json(
      { error: "send_failed", message: e instanceof Error ? e.message : String(e) },
      { status: 502 }
    );
  }

  const now = Math.floor(Date.now() / 1000);
  await db.updateReport(report.id, {
    client_notified_at: now,
    client_notification_subject: subject,
    client_notification_html: html,
  });

  return Response.json({ ok: true, notifiedAt: now });
}
