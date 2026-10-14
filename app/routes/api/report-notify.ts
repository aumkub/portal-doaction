import type { Route } from "./+types/report-notify";
import { requireAdmin } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";
import { notifyReportToClient } from "~/lib/report-notify.server";

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

  const result = await notifyReportToClient({
    env,
    db: createDB(env.DB),
    reportId,
    origin: new URL(request.url).origin,
  });
  if (!result.ok) {
    return Response.json(
      { error: result.error, message: result.message },
      { status: result.status }
    );
  }
  return Response.json({ ok: true, notifiedAt: result.notifiedAt });
}
