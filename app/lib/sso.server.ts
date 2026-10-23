import { createCappedClientSession } from "~/lib/auth.server";
import { sha256hex } from "~/lib/agent/crypto";
import { createDB } from "~/lib/db.server";
import { generateId } from "~/lib/utils";

/** Sessions opened from wp-admin last 8 hours and are never renewed. */
const SSO_SESSION_S = 8 * 3600;
const PATH_RE = /^\/tickets\/(new|[A-Za-z0-9_-]{8,64})$/;

type Grant = { user_id: string; client_id: string; site_id: string; email: string; path?: string };

/** Consumes a token atomically: of two concurrent uses, only one gets the grant. */
async function consume(env: CloudflareEnv, kind: "login" | "verify", token: string): Promise<Grant | null> {
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const row = await env.DB
    .prepare("DELETE FROM sso_tokens WHERE hash = ? AND kind = ? AND expires_at > ? RETURNING data")
    .bind(await sha256hex(token), kind, Math.floor(Date.now() / 1000))
    .first<{ data: string }>();
  return row ? (JSON.parse(row.data) as Grant) : null;
}

/**
 * Turns a login or verify token into an 8-hour client session. Returns the
 * redirect Response, or null when the token is unknown, used or expired, or
 * the client no longer qualifies.
 */
export async function redeemSsoToken(
  env: CloudflareEnv,
  request: Request,
  kind: "login" | "verify",
  token: string
): Promise<Response | null> {
  const grant = await consume(env, kind, token);
  if (!grant) return null;
  const db = createDB(env.DB);
  const [user, client] = await Promise.all([db.getUserById(grant.user_id), db.getClientById(grant.client_id)]);
  if (!user || user.role !== "client" || !client || client.kind !== "client" || !client.sso_enabled || client.user_id !== user.id) {
    return null;
  }
  const now = Math.floor(Date.now() / 1000);
  const statements = [
    env.DB.prepare("INSERT INTO sso_logins (id, client_id, site_id, wp_email, outcome, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(generateId(), client.id, grant.site_id, grant.email, kind === "verify" ? "verified" : "used", request.headers.get("CF-Connecting-IP"), now),
  ];
  if (kind === "verify") {
    statements.push(
      env.DB.prepare("INSERT OR REPLACE INTO sso_verified (site_id, email, verified_at) VALUES (?, ?, ?)").bind(grant.site_id, grant.email, now)
    );
  }
  await env.DB.batch(statements);

  const path = grant.path && PATH_RE.test(grant.path) ? grant.path : "/tickets/new";
  return new Response(null, {
    status: 302,
    headers: {
      Location: path,
      "Set-Cookie": await createCappedClientSession(env, user.id, SSO_SESSION_S),
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "no-store",
    },
  });
}
