import type { Route } from "./+types/report-email-preview";
import { requireAdmin } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";
import { buildReportCustomerNotification } from "~/lib/report-customer-email.server";

/** GET /api/report-email-preview?reportId= — admin-only JSON for modal preview */
export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  await requireAdmin(request, env.DB, env.SESSIONPORTAL);

  const reportId = new URL(request.url).searchParams.get("reportId");
  if (!reportId) {
    return Response.json({ error: "missing_report" }, { status: 400 });
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
  const reportUrl = `${String(origin).replace(/\/$/, "")}/reports/${report.id}`;

  const { subject, html, text } = buildReportCustomerNotification({
    companyName: client.company_name,
    contactName: user.name,
    reportTitle: report.title,
    year: report.year,
    month: report.month,
    summary: report.summary,
    reportUrl,
  });

  return Response.json({
    subject,
    html,
    text,
    to: user.email,
    toName: user.name,
  });
}
