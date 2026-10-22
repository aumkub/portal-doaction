/**
 * Site-care agent endpoints (pull model: the WordPress plugin always calls us).
 *   POST /agent/v1/pair       {code, site_url, wp_version, plugin_version} -> {site_id, secret}
 *   POST /agent/v1/heartbeat  signed; body = inventory JSON -> {ok, server_time}
 * P0 is read-only: no commands are ever returned to the site.
 */
import { createDB } from "~/lib/db.server";
import { generateId } from "~/lib/utils";
import {
  decryptSecret, encryptSecret, normalizePairCode, randomHex, sha256hex, signPayload, verifySignature,
} from "./crypto";
import { InventorySchema, PairSchema } from "./inventory";

const MAX_BODY_BYTES = 256 * 1024;
const HEARTBEAT_MIN_INTERVAL_S = 60;
const PAIR_ATTEMPTS_PER_IP = 10; // per 15 minutes

export function isAgentPath(pathname: string): boolean {
  return pathname.startsWith("/agent/v1/");
}

function json(status: number, data: unknown, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extraHeaders },
  });
}

/** Signed response so the plugin can verify it really came from the portal. */
async function signedJson(secret: string, status: number, data: unknown): Promise<Response> {
  const body = JSON.stringify(data);
  const ts = String(Math.floor(Date.now() / 1000));
  const nonce = randomHex(16);
  const sig = await signPayload(secret, ts, nonce, body);
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store",
      "X-DA-Timestamp": ts, "X-DA-Nonce": nonce, "X-DA-Signature": sig,
    },
  });
}

async function readBody(request: Request): Promise<Uint8Array | null> {
  const len = Number(request.headers.get("Content-Length") ?? "0");
  if (len > MAX_BODY_BYTES) return null;
  const buf = new Uint8Array(await request.arrayBuffer());
  return buf.byteLength > MAX_BODY_BYTES ? null : buf;
}

export async function handleAgentRequest(request: Request, env: CloudflareEnv): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (request.method !== "POST") return json(405, { error: "method_not_allowed" });
  if (!(request.headers.get("Content-Type") ?? "").includes("application/json")) {
    return json(415, { error: "json_required" });
  }
  if (!env.SESSION_SECRET) return json(503, { error: "not_configured" });
  try {
    if (pathname === "/agent/v1/pair") return await handlePair(request, env);
    if (pathname === "/agent/v1/heartbeat") return await handleHeartbeat(request, env);
    return json(404, { error: "not_found" });
  } catch (err) {
    console.error("agent error", err);
    return json(500, { error: "server_error" });
  }
}

async function handlePair(request: Request, env: CloudflareEnv): Promise<Response> {
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const rlKey = `agent-pair-ip:${ip}`;
  const attempts = Number((await env.SESSIONPORTAL.get(rlKey)) ?? "0");
  if (attempts >= PAIR_ATTEMPTS_PER_IP) return json(429, { error: "rate_limited" });
  await env.SESSIONPORTAL.put(rlKey, String(attempts + 1), { expirationTtl: 900 });

  const raw = await readBody(request);
  if (!raw) return json(413, { error: "too_large" });
  let parsedJson: unknown;
  try { parsedJson = JSON.parse(new TextDecoder().decode(raw)); } catch { return json(400, { error: "bad_json" }); }
  const parsed = PairSchema.safeParse(parsedJson);
  if (!parsed.success) return json(400, { error: "invalid_payload" });

  const db = createDB(env.DB);
  const now = Math.floor(Date.now() / 1000);
  const codeHash = await sha256hex(normalizePairCode(parsed.data.code));
  const clientId = await db.consumeSitePairCode(codeHash, now);
  if (!clientId) return json(401, { error: "invalid_code" });

  const siteId = generateId();
  const secret = randomHex(32);
  await db.createSite({
    id: siteId,
    client_id: clientId,
    site_url: parsed.data.site_url,
    secret_enc: await encryptSecret(env.SESSION_SECRET, secret),
    paired_at: now,
    plugin_version: parsed.data.plugin_version,
    wp_version: parsed.data.wp_version,
  });
  // Secret is returned exactly once; sign the response with it so the plugin can sanity-check.
  return signedJson(secret, 200, { site_id: siteId, secret });
}

async function handleHeartbeat(request: Request, env: CloudflareEnv): Promise<Response> {
  const siteId = request.headers.get("X-DA-Site") ?? "";
  const timestamp = request.headers.get("X-DA-Timestamp") ?? "";
  const nonce = request.headers.get("X-DA-Nonce") ?? "";
  const signature = (request.headers.get("X-DA-Signature") ?? "").toLowerCase();
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(siteId)) return json(401, { error: "unauthorized" });

  const raw = await readBody(request);
  if (!raw) return json(413, { error: "too_large" });

  const db = createDB(env.DB);
  const site = await db.getSiteById(siteId);
  if (!site || site.revoked_at) return json(401, { error: "revoked" });

  const secret = await decryptSecret(env.SESSION_SECRET, site.secret_enc);
  const verdict = await verifySignature({ secret, timestamp, nonce, signature, body: raw });
  if (verdict !== "ok") return json(401, { error: verdict });

  const nonceKey = `agent-nonce:${siteId}:${nonce}`;
  if (await env.SESSIONPORTAL.get(nonceKey)) return json(401, { error: "replay" });
  await env.SESSIONPORTAL.put(nonceKey, "1", { expirationTtl: 600 });

  const rlKey = `agent-hb:${siteId}`;
  if (await env.SESSIONPORTAL.get(rlKey)) return signedJson(secret, 429, { error: "rate_limited", retry_after: HEARTBEAT_MIN_INTERVAL_S });
  await env.SESSIONPORTAL.put(rlKey, "1", { expirationTtl: HEARTBEAT_MIN_INTERVAL_S });

  let body: unknown;
  try { body = JSON.parse(new TextDecoder().decode(raw)); } catch { return signedJson(secret, 400, { error: "bad_json" }); }
  const parsed = InventorySchema.safeParse(body);
  if (!parsed.success) {
    return signedJson(secret, 400, { error: "invalid_inventory", issues: parsed.error.issues.slice(0, 5).map((i) => i.path.join(".")) });
  }

  const inv = parsed.data;
  const now = Math.floor(Date.now() / 1000);
  await db.saveSiteHeartbeat({
    site_id: siteId, now, json: JSON.stringify(inv), site_url: inv.site_url,
    plugin_version: inv.plugin_version, wp_version: inv.wp_version, php_version: inv.php_version,
  });
  return signedJson(secret, 200, { ok: true, server_time: now });
}
