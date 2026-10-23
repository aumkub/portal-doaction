/**
 * Site-care agent endpoints (pull model: the WordPress plugin always calls us).
 *   POST /agent/v1/pair       {code, site_url, wp_version, plugin_version} -> {site_id, secret}
 *   POST /agent/v1/heartbeat  signed; body = inventory JSON -> {ok, server_time, widget}
 *   POST /agent/v1/jobs/next  signed; claims the next due update job -> {job | null}
 *   POST /agent/v1/jobs/report signed; {job_id, status, result_version, log}
 *   POST /agent/v1/ticket     signed; {title, description} from the wp-admin widget
 * Jobs are limited to the fixed list in JobSchema: update one plugin, theme or core.
 */
import { createDB } from "~/lib/db.server";
import { generateId } from "~/lib/utils";
import {
  decryptSecret, encryptSecret, normalizePairCode, randomHex, sha256hex, signPayload, verifySignature,
} from "./crypto";
import { pendingUpdates } from "./update-level";
import type { SiteInventory } from "./inventory";
import { InventorySchema, JobReportSchema, PairSchema, SsoRequestSchema, WidgetTicketSchema } from "./inventory";
import { parseClientCcEmails } from "~/lib/client-cc";
import { ticketGate } from "~/lib/ticket-guard.server";
import { CARE_PAUSED_KEY, addJobToDraftReport } from "./jobs.server";
import type { SiteRow } from "~/lib/db.server";
import { emailSsoVerification, emailTeamNewTicket, emailTicketReceipt } from "~/lib/email-alerts.server";
import { sendTelegramNotificationForClient } from "~/lib/telegram.server";
import type { Client } from "~/types";
import { fetchAllMonitors, hostOf } from "~/lib/uptime.server";
import { getUptimeRobotKey } from "~/lib/secrets.server";

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

const PLUGIN_FILE_RE = /^\/agent\/v1\/plugin\/(doaction-care-\d+\.\d+\.\d+\.zip)$/;

function newerVersion(a: string, b: string): boolean {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  return false;
}

/** Latest signed plugin release (uploaded by scripts/release-care-plugin.mjs). */
async function pluginRelease(env: CloudflareEnv, origin: string) {
  const obj = await env.ATTACHMENTS.get("care-plugin/latest.json").catch(() => null);
  if (!obj) return null;
  try {
    const m = (await obj.json()) as {
      version: string; file: string; signature: string; size: number; sha256?: string; version_signature?: string;
      requires_wp?: string; requires_php?: string;
    };
    if (!/^\d+\.\d+\.\d+$/.test(m.version) || !PLUGIN_FILE_RE.test(`/agent/v1/plugin/${m.file}`)) return null;
    return {
      version: m.version, signature: m.signature, size: m.size,
      sha256: m.sha256 ?? null, version_signature: m.version_signature ?? null,
      requires_wp: m.requires_wp ?? null, requires_php: m.requires_php ?? null,
      package: `${origin}/agent/v1/plugin/${m.file}`,
    };
  } catch {
    return null;
  }
}

export async function handleAgentRequest(request: Request, env: CloudflareEnv): Promise<Response> {
  const { pathname } = new URL(request.url);
  const download = pathname.match(PLUGIN_FILE_RE);
  if (download && request.method === "GET") {
    // Public on purpose: the plugin verifies the Ed25519 signature before installing.
    const obj = await env.ATTACHMENTS.get(`care-plugin/${download[1]}`);
    if (!obj) return json(404, { error: "not_found" });
    return new Response(obj.body, {
      headers: { "Content-Type": "application/zip", "Content-Length": String(obj.size), "Cache-Control": "no-store" },
    });
  }
  if (request.method !== "POST") return json(405, { error: "method_not_allowed" });
  if (!(request.headers.get("Content-Type") ?? "").includes("application/json")) {
    return json(415, { error: "json_required" });
  }
  if (!env.SESSION_SECRET) return json(503, { error: "not_configured" });
  try {
    if (pathname === "/agent/v1/pair") return await handlePair(request, env);
    if (pathname === "/agent/v1/heartbeat") return await handleHeartbeat(request, env);
    if (pathname === "/agent/v1/jobs/next") return await handleJobsNext(request, env);
    if (pathname === "/agent/v1/jobs/report") return await handleJobReport(request, env);
    if (pathname === "/agent/v1/ticket") return await handleWidgetTicket(request, env);
    if (pathname === "/agent/v1/sso") return await handleSso(request, env);
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
  // A site that pairs again (reinstall, new code) replaces its older pairing.
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE site_jobs SET status = 'cancelled', finished_at = ? WHERE status = 'queued'
         AND site_id IN (SELECT id FROM sites WHERE client_id = ? AND site_url = ? AND id != ? AND revoked_at IS NULL)`
    ).bind(now, clientId, parsed.data.site_url, siteId),
    env.DB.prepare(
      "UPDATE sites SET revoked_at = ? WHERE client_id = ? AND site_url = ? AND id != ? AND revoked_at IS NULL"
    ).bind(now, clientId, parsed.data.site_url, siteId),
  ]);
  // Secret is returned exactly once; sign the response with it so the plugin can sanity-check.
  return signedJson(secret, 200, { site_id: siteId, secret });
}

type Authed = { site: SiteRow; secret: string; raw: Uint8Array };

/** Verifies the site's signature and nonce. Returns a ready error Response on failure. */
async function authenticate(request: Request, env: CloudflareEnv): Promise<Authed | Response> {
  const siteId = request.headers.get("X-DA-Site") ?? "";
  const timestamp = request.headers.get("X-DA-Timestamp") ?? "";
  const nonce = request.headers.get("X-DA-Nonce") ?? "";
  const signature = (request.headers.get("X-DA-Signature") ?? "").toLowerCase();
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(siteId)) return json(401, { error: "unauthorized" });

  const raw = await readBody(request);
  if (!raw) return json(413, { error: "too_large" });

  const site = await createDB(env.DB).getSiteById(siteId);
  if (!site || site.revoked_at) return json(401, { error: "revoked" });

  const secret = await decryptSecret(env.SESSION_SECRET, site.secret_enc);
  const verdict = await verifySignature({ secret, timestamp, nonce, signature, body: raw });
  if (verdict !== "ok") return json(401, { error: verdict });

  // Primary-key insert: of two concurrent requests with the same nonce, one fails.
  const fresh = await env.DB
    .prepare("INSERT OR IGNORE INTO agent_nonces (nonce_key, expires_at) VALUES (?, ?)")
    .bind(`${siteId}:${nonce}`, Math.floor(Date.now() / 1000) + 600)
    .run();
  if (!fresh.meta.changes) return json(401, { error: "replay" });
  return { site, secret, raw };
}

function parseBody(raw: Uint8Array): unknown {
  try { return JSON.parse(new TextDecoder().decode(raw)); } catch { return undefined; }
}

async function handleHeartbeat(request: Request, env: CloudflareEnv): Promise<Response> {
  const auth = await authenticate(request, env);
  if (auth instanceof Response) return auth;
  const { site, secret, raw } = auth;
  const siteId = site.id;
  const db = createDB(env.DB);

  const rlKey = `agent-hb:${siteId}`;
  if (await env.SESSIONPORTAL.get(rlKey)) return signedJson(secret, 429, { error: "rate_limited", retry_after: HEARTBEAT_MIN_INTERVAL_S });
  await env.SESSIONPORTAL.put(rlKey, "1", { expirationTtl: HEARTBEAT_MIN_INTERVAL_S });

  const parsed = InventorySchema.safeParse(parseBody(raw));
  if (!parsed.success) {
    return signedJson(secret, 400, { error: "invalid_inventory", issues: parsed.error.issues.slice(0, 5).map((i) => i.path.join(".")) });
  }

  const inv = parsed.data;
  const now = Math.floor(Date.now() / 1000);
  await db.saveSiteHeartbeat({
    site_id: siteId, now, json: JSON.stringify(inv), site_url: inv.site_url,
    plugin_version: inv.plugin_version, wp_version: inv.wp_version, php_version: inv.php_version,
  });
  await notifyNewMajorUpdates(env, site, inv).catch((e) => console.error("[agent] major notify failed", e));

  const release = await pluginRelease(env, new URL(request.url).origin);
  // Our own agent is kept current without waiting for the team: queue a
  // self-update (same backup/rollback path) when a newer signed release exists.
  const alreadyDone = release && (await env.DB
    // Any earlier attempt at this release (done, failed or rolled back) stops
    // the hourly auto-queue; a failed release is retried only by a person.
    .prepare("SELECT 1 FROM site_jobs WHERE site_id = ? AND slug = 'doaction-care/doaction-care.php' AND status != 'cancelled' AND (to_version = ? OR result_version = ?) LIMIT 1")
    .bind(siteId, release.version, release.version)
    .first());
  if (release && !alreadyDone && newerVersion(release.version, inv.plugin_version) && !(await env.SESSIONPORTAL.get(CARE_PAUSED_KEY))) {
    await db.queueSiteJobs([{
      id: generateId(), site_id: siteId, kind: "plugin", slug: "doaction-care/doaction-care.php", name: "Do Action: Care",
      from_version: inv.plugin_version, to_version: release.version, not_before: 0, created_by: "system", created_at: now,
    }]);
  }
  return signedJson(secret, 200, {
    ok: true, server_time: now,
    widget: await widgetData(env, site, now),
    plugin_release: release,
  });
}

/**
 * In-app notification to admins the first time a site is offered a major
 * update (new major version of a plugin/theme, or a WordPress x.y release).
 * Minor and patch updates only show as small badges and in the daily digest.
 */
async function notifyNewMajorUpdates(env: CloudflareEnv, site: SiteRow, inv: SiteInventory) {
  const majors = pendingUpdates(inv).filter((u) => u.level === "major");
  if (majors.length === 0) return;
  const fresh: typeof majors = [];
  for (const u of majors) {
    const key = `major-seen:${site.id}:${u.kind}:${u.slug}:${u.to}`;
    if (await env.SESSIONPORTAL.get(key)) continue;
    await env.SESSIONPORTAL.put(key, "1", { expirationTtl: 180 * 86400 });
    fresh.push(u);
  }
  if (fresh.length === 0) return;
  const db = createDB(env.DB);
  const host = new URL(site.site_url).host;
  const body = fresh.map((u) => `${u.name} ${u.from} → ${u.to}`).join(", ").slice(0, 400);
  const admins = await db.listAdminUsers();
  await Promise.all(admins.map((a) => db.createNotification({
    id: generateId(), user_id: a.id, type: "system", title: `อัปเดตใหญ่ (Major) ที่ ${host}`, body, link: "/admin/sites?filter=major", read: 0,
  })));
}

/** What the wp-admin dashboard widget shows. Only this client's own data. */
async function widgetData(env: CloudflareEnv, site: SiteRow, now: number) {
  const db = createDB(env.DB);
  const client = await db.getClientById(site.client_id);
  const d = new Date((now + 7 * 3600) * 1000); // Bangkok month
  const monthStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000 - 7 * 3600;
  const open = await env.DB
    .prepare("SELECT COUNT(*) AS n FROM support_tickets WHERE client_id = ? AND status NOT IN ('resolved','closed') AND deleted_at IS NULL")
    .bind(site.client_id)
    .first<{ n: number }>()
    .catch(() => null);
  const host = hostOf(site.site_url);
  const monitors = await fetchAllMonitors(getUptimeRobotKey(env), env.SESSIONPORTAL).catch(() => null);
  const monitor = monitors?.find((m) => m.host === host) ?? null;
  return {
    uptime30: monitor?.uptime30 ?? null,
    company: client?.company_name ?? "",
    contract_end: client?.contract_end ?? null,
    open_tickets: open?.n ?? 0,
    updates_this_month: await db.countSiteJobsSince(site.id, monthStart),
    portal_url: env.APP_URL,
  };
}

async function handleJobsNext(request: Request, env: CloudflareEnv): Promise<Response> {
  const auth = await authenticate(request, env);
  if (auth instanceof Response) return auth;
  if (await env.SESSIONPORTAL.get(CARE_PAUSED_KEY)) return signedJson(auth.secret, 200, { job: null, paused: true });
  const job = await createDB(env.DB).claimNextSiteJob(auth.site.id, Math.floor(Date.now() / 1000));
  return signedJson(auth.secret, 200, {
    job: job && { id: job.id, kind: job.kind, slug: job.slug, to_version: job.to_version },
  });
}

async function handleJobReport(request: Request, env: CloudflareEnv): Promise<Response> {
  const auth = await authenticate(request, env);
  if (auth instanceof Response) return auth;
  const parsed = JobReportSchema.safeParse(parseBody(auth.raw));
  if (!parsed.success) return signedJson(auth.secret, 400, { error: "invalid_payload" });
  const now = Math.floor(Date.now() / 1000);
  const ok = await createDB(env.DB).finishSiteJob({
    id: parsed.data.job_id, site_id: auth.site.id, status: parsed.data.status,
    result_version: parsed.data.result_version, log: parsed.data.log, now,
  });
  // The site sends a fresh inventory right after its jobs; let it through the heartbeat limiter.
  if (ok) await env.SESSIONPORTAL.delete(`agent-hb:${auth.site.id}`);
  if (ok && parsed.data.status === "succeeded") {
    await addJobToDraftReport(env, auth.site.client_id, now).catch((e) => console.error("[agent] report fill failed", e));
  }
  return signedJson(auth.secret, ok ? 200 : 409, { ok });
}

async function handleWidgetTicket(request: Request, env: CloudflareEnv): Promise<Response> {
  const auth = await authenticate(request, env);
  if (auth instanceof Response) return auth;
  const rlKey = `agent-ticket:${auth.site.id}`;
  const recent = Number((await env.SESSIONPORTAL.get(rlKey)) ?? "0");
  if (recent >= 5) return signedJson(auth.secret, 429, { error: "rate_limited" });
  await env.SESSIONPORTAL.put(rlKey, String(recent + 1), { expirationTtl: 3600 });

  const parsed = WidgetTicketSchema.safeParse(parseBody(auth.raw));
  if (!parsed.success) return signedJson(auth.secret, 400, { error: "invalid_payload" });
  const db = createDB(env.DB);
  const client = await db.getClientById(auth.site.client_id);
  if (!client) return signedJson(auth.secret, 404, { error: "no_client" });
  const gate = await ticketGate(env, client);
  if (!gate.ok) return signedJson(auth.secret, 429, { error: gate.reason, message: gate.message });

  const ticketId = generateId();
  const site = new URL(auth.site.site_url).host;
  const reporterEmail = parsed.data.reporter_email;
  const reporterLabel = parsed.data.reporter ?? (reporterEmail ? `${parsed.data.reporter_name ?? ""} <${reporterEmail}>`.trim() : null);
  const description = `${parsed.data.description}\n\n— แจ้งจากหน้า wp-admin ของ ${site}${reporterLabel ? ` โดย ${reporterLabel}` : ""}`;
  await db.createTicket({
    id: ticketId, client_id: client.id, title: parsed.data.title, description,
    priority: "medium", status: "open", created_by: client.user_id, assigned_to: null, resolved_at: null,
  });
  const notification = { title: `New ticket from ${client.company_name}`, body: parsed.data.title, link: `/admin/tickets/${ticketId}` };
  const admins = await db.listAdminUsers();
  await Promise.all(admins.map((a) => db.createNotification({ id: generateId(), user_id: a.id, type: "ticket", ...notification, read: 0 })));
  await sendTelegramNotificationForClient({ db, appUrl: env.APP_URL, notification, clientId: client.id }).catch((e) => console.error("[agent ticket] telegram failed", e));
  try {
    await emailTeamNewTicket(env, db, { id: ticketId, title: parsed.data.title, description, priority: "medium" }, client.company_name);
  } catch (e) {
    console.error("[agent ticket] team email failed", e);
  }

  // Reporters who are the client (account or CC) can jump straight to the
  // ticket via SSO; anyone else gets an email receipt instead.
  const isClientContact = Boolean(reporterEmail && (await clientEmails(db, client)).has(reporterEmail));
  if (reporterEmail && !isClientContact) {
    await emailTicketReceipt(env, db, { email: reporterEmail, name: parsed.data.reporter_name ?? reporterEmail }, { title: parsed.data.title }, site)
      .catch((e) => console.error("[agent ticket] receipt failed", e));
  }
  const canOpen = isClientContact && client.kind === "client" && Boolean(client.sso_enabled);
  return signedJson(auth.secret, 200, { ok: true, ticket_id: ticketId, can_open: canOpen });
}

/** Emails allowed to act as this client from wp-admin: the account email and its CC list. */
async function clientEmails(db: ReturnType<typeof createDB>, client: Client): Promise<Set<string>> {
  const user = await db.getUserById(client.user_id);
  const out = new Set(parseClientCcEmails(client.cc_emails).map((e) => e.toLowerCase()));
  if (user?.role === "client" && user.email) out.add(user.email.toLowerCase());
  return out;
}

export const SSO_TOKEN_TTL_S = 60;
const SSO_VERIFY_TTL_S = 30 * 60;

async function issueSsoToken(env: CloudflareEnv, kind: "login" | "verify", grant: unknown, ttl: number): Promise<string> {
  const token = randomHex(32);
  await env.DB
    .prepare("INSERT INTO sso_tokens (hash, kind, data, expires_at) VALUES (?, ?, ?, ?)")
    .bind(await sha256hex(token), kind, JSON.stringify(grant), Math.floor(Date.now() / 1000) + ttl)
    .run();
  return token;
}
const SSO_PER_SITE_PER_HOUR = 10;

/**
 * One-click sign-in from the client's wp-admin. The site (signed) asks for a
 * single-use, 60-second token for the WordPress user's email; it is issued
 * only when that email is the client's account email or one of its CC
 * addresses. The browser then POSTs the token to /sso.
 */
async function handleSso(request: Request, env: CloudflareEnv): Promise<Response> {
  const auth = await authenticate(request, env);
  if (auth instanceof Response) return auth;
  const parsed = SsoRequestSchema.safeParse(parseBody(auth.raw));
  if (!parsed.success) return signedJson(auth.secret, 400, { error: "invalid_payload" });

  const db = createDB(env.DB);
  const now = Math.floor(Date.now() / 1000);
  const client = await db.getClientById(auth.site.client_id);
  const ip = request.headers.get("CF-Connecting-IP");
  const log = (outcome: string) =>
    env.DB.prepare("INSERT INTO sso_logins (id, client_id, site_id, wp_email, outcome, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(generateId(), auth.site.client_id, auth.site.id, parsed.data.email, outcome, ip, now)
      .run();
  const refuse = async (reason: string) => {
    await log(reason);
    return signedJson(auth.secret, 200, { ok: false, reason });
  };

  if (!client || client.deleted_at || client.kind !== "client") return refuse("not_client");
  if (!client.sso_enabled) return refuse("disabled");

  const rlKey = `sso-rl:${auth.site.id}`;
  const used = Number((await env.SESSIONPORTAL.get(rlKey)) ?? "0");
  if (used >= SSO_PER_SITE_PER_HOUR) return refuse("rate_limited");
  await env.SESSIONPORTAL.put(rlKey, String(used + 1), { expirationTtl: 3600 });

  const user = await db.getUserById(client.user_id);
  if (!user || user.role !== "client" || !(await clientEmails(db, client)).has(parsed.data.email)) return refuse("email_mismatch");

  const origin = new URL(request.url).origin;
  const grant = { user_id: user.id, client_id: client.id, site_id: auth.site.id, email: parsed.data.email, path: parsed.data.path };
  const verified = await env.DB
    .prepare("SELECT 1 FROM sso_verified WHERE site_id = ? AND email = ?")
    .bind(auth.site.id, parsed.data.email)
    .first();
  if (!verified) {
    // First use of this email from this site: prove the person can read the
    // inbox. A WordPress admin who only changed a user's email cannot.
    const verifyToken = await issueSsoToken(env, "verify", grant, SSO_VERIFY_TTL_S);
    await emailSsoVerification(env, db, { email: parsed.data.email, name: user.name }, `${origin}/sso/verify?t=${verifyToken}`, new URL(auth.site.site_url).host);
    await log("verify_sent");
    return signedJson(auth.secret, 200, { ok: false, reason: "verify_sent", email: parsed.data.email });
  }

  const token = await issueSsoToken(env, "login", grant, SSO_TOKEN_TTL_S);
  await log("issued");
  return signedJson(auth.secret, 200, { ok: true, token, url: `${origin}/sso` });
}
