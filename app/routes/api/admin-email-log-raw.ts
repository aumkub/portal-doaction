import type { Route } from "./+types/admin-email-log-raw";
import { requireAdmin } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";

/**
 * The email's HTML exactly as sent, as its own page — for "open in new tab"
 * and the in-page preview frame. Served sandboxed so any script in a stored
 * body cannot run with the admin's session.
 */
export async function loader({ request, context, params }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  await requireAdmin(request, env.DB, env.SESSIONPORTAL);
  const log = await createDB(env.DB).getEmailLog(params.logId);
  if (!log) return new Response("Not found", { status: 404 });
  return new Response(log.html_body, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": "sandbox; default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; font-src https:",
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
    },
  });
}
