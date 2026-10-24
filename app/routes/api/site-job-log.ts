import type { Route } from "./+types/site-job-log";
import { requireCoAdminOrAdmin } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";

/** One update job's log, loaded when someone opens it (job lists don't carry logs). */
export async function loader({ request, params, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const user = await requireCoAdminOrAdmin(request, env.DB, env.SESSIONPORTAL);
  const row = await env.DB
    .prepare("SELECT j.log, s.client_id FROM site_jobs j JOIN sites s ON s.id = j.site_id WHERE j.id = ?")
    .bind(params.id)
    .first<{ log: string | null; client_id: string }>();
  if (!row) throw new Response("Not found", { status: 404 });
  if (user.role !== "admin") {
    const assigned = await createDB(env.DB).listCoAdminClients(user.id);
    if (!assigned.some((a) => a.client_id === row.client_id)) throw new Response("Forbidden", { status: 403 });
  }
  return { log: row.log ?? "" };
}
