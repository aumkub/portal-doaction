import { redirect } from "react-router";
import type { Route } from "./+types/sso";
import { createCappedClientSession } from "~/lib/auth.server";
import { sha256hex } from "~/lib/agent/crypto";
import { createDB } from "~/lib/db.server";
import { generateId } from "~/lib/utils";

/** Sessions opened from wp-admin last 8 hours and are never renewed. */
const SSO_SESSION_S = 8 * 3600;

export function loader() {
  return redirect("/login");
}

/**
 * Lands the auto-submitted form from the do action Care widget. The token
 * is single use: it is deleted before anything else happens.
 */
export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const form = await request.formData();
  const token = String(form.get("token") ?? "");
  if (!/^[0-9a-f]{64}$/.test(token)) return redirect("/login");

  const key = `sso:${await sha256hex(token)}`;
  const raw = await env.SESSIONPORTAL.get(key);
  if (!raw) return redirect("/login?redirect=%2Ftickets%2Fnew");
  await env.SESSIONPORTAL.delete(key);
  const grant = JSON.parse(raw) as { user_id: string; client_id: string; site_id: string; email: string };

  const db = createDB(env.DB);
  const [user, client] = await Promise.all([db.getUserById(grant.user_id), db.getClientById(grant.client_id)]);
  if (!user || user.role !== "client" || !client || client.kind !== "client" || !client.sso_enabled || client.user_id !== user.id) {
    return redirect("/login");
  }

  await env.DB.prepare("INSERT INTO sso_logins (id, client_id, site_id, wp_email, outcome, ip, created_at) VALUES (?, ?, ?, ?, 'used', ?, ?)")
    .bind(generateId(), client.id, grant.site_id, grant.email, request.headers.get("CF-Connecting-IP"), Math.floor(Date.now() / 1000))
    .run();

  return redirect("/tickets/new", {
    headers: {
      "Set-Cookie": await createCappedClientSession(env, user.id, SSO_SESSION_S),
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "no-store",
    },
  });
}
