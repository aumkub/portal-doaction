/**
 * Portal side of remote updates: queueing jobs from the latest inventory,
 * the emergency stop switch, and waking a site so it pulls its jobs now
 * instead of at its next 15-minute heartbeat.
 */
import { createDB, type SiteJobKind } from "~/lib/db.server";
import { generateId } from "~/lib/utils";
import { decryptSecret, randomHex, signPayload } from "./crypto";
import { InventorySchema, type SiteInventory } from "./inventory";
import { backupIssues, type BackupIssue } from "./backup-health";
import { pendingUpdates, type PendingUpdate } from "./update-level";

export const CARE_PAUSED_KEY = "care:paused";
/** A running job with no report after this long is marked failed. */
export const JOB_STALE_AFTER_S = 20 * 60;

export type JobRequest = { kind: SiteJobKind; slug: string };

/** Night window (Bangkok 01:00–05:00): the next 01:00 local time, as unix seconds. */
export function nextNightWindow(now: number): number {
  const local = new Date((now + 7 * 3600) * 1000);
  let start = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), 1) / 1000 - 7 * 3600;
  if (start + 4 * 3600 <= now) start += 86400;
  return Math.max(start, now);
}

/**
 * Queues one job per requested item that the site's own inventory says has an
 * update. Anything not in the inventory is dropped, so a forged form can't
 * name arbitrary slugs.
 */
export async function queueJobs(opts: {
  env: CloudflareEnv;
  siteId: string;
  inventory: SiteInventory;
  items: JobRequest[];
  userId: string;
  notBefore: number;
}): Promise<number> {
  const { env, siteId, inventory, items, userId, notBefore } = opts;
  const now = Math.floor(Date.now() / 1000);
  const jobs = items.flatMap((it): { kind: SiteJobKind; slug: string; name: string; from: string; to: string | null }[] => {
    if (it.kind === "core") {
      return inventory.core_update && !inventory.core_update_blocked
        ? [{ kind: it.kind, slug: "wordpress", name: "WordPress", from: inventory.wp_version, to: inventory.core_update }]
        : [];
    }
    const list = it.kind === "plugin" ? inventory.plugins : inventory.themes;
    const found = list.find((p) => p.slug === it.slug && p.update_version && !p.update_blocked);
    return found ? [{ kind: it.kind, slug: found.slug, name: found.name, from: found.version, to: found.update_version }] : [];
  });
  return createDB(env.DB).queueSiteJobs(
    jobs.map((j) => ({
      id: generateId(), site_id: siteId, kind: j.kind, slug: j.slug, name: j.name,
      from_version: j.from, to_version: j.to, not_before: notBefore, created_by: userId, created_at: now,
    })),
  );
}

/**
 * Signed, content-free nudge: the site answers by calling /agent/v1/jobs/next.
 * Failure is harmless (the site still polls on its heartbeat).
 */
export async function wakeSite(env: CloudflareEnv, site: { id: string; secret_enc: string }, homeUrl: string): Promise<boolean> {
  try {
    const secret = await decryptSecret(env.SESSION_SECRET, site.secret_enc);
    const body = JSON.stringify({ site_id: site.id });
    const ts = String(Math.floor(Date.now() / 1000));
    const nonce = randomHex(16);
    const url = new URL(homeUrl);
    // Sites saved as http:// usually 301 to https, and a redirected POST loses its body.
    url.protocol = "https:";
    url.searchParams.set("rest_route", "/doaction-care/v1/wake");
    const headers = {
      "X-DA-Site": site.id, "X-DA-Timestamp": ts, "X-DA-Nonce": nonce,
      "X-DA-Signature": await signPayload(secret, ts, nonce, body),
    };
    const r = env.WAKE_RELAY_URL && env.WAKE_RELAY_SECRET
      ? await viaRelay(env.WAKE_RELAY_URL, env.WAKE_RELAY_SECRET, url.toString(), headers, body)
      : await direct(url.toString(), headers, body);
    let detail = r.status ? `HTTP ${r.status}` : r.error === "timeout" ? "ไม่ตอบใน 25 วินาที" : r.error?.startsWith("relay") ? r.error : "เชื่อมต่อไม่ได้";
    const ok = r.status >= 200 && r.status < 300;
    if (!ok && r.status) {
      // Say who refused: Cloudflare (challenge/WAF on the site's zone) or the site itself.
      const title = r.body.match(/<title>([^<]{1,80})<\/title>/i)?.[1]?.trim();
      const code = r.body.match(/"code"\s*:\s*"([\w-]{1,40})"/)?.[1];
      const by = r.mitigated ? `Cloudflare ${r.mitigated}` : title ?? code;
      if (by) detail += ` · ${by}`;
    }
    if (env.WAKE_RELAY_URL) detail += " (ผ่าน relay)";
    await recordWake(env, site.id, ok, detail);
    return ok;
  } catch (e) {
    const why = e instanceof Error && e.name === "TimeoutError" ? "ไม่ตอบใน 25 วินาที" : "เชื่อมต่อไม่ได้";
    const msg = e instanceof Error ? e.message.slice(0, 120) : "";
    await recordWake(env, site.id, false, `${why}${env.WAKE_RELAY_URL ? " (ผ่าน relay)" : ""}${msg ? ` · ${msg}` : ""}`);
    return false;
  }
}

type WakeResult = { status: number; mitigated: string | null; body: string; error?: string };

async function direct(url: string, headers: Record<string, string>, body: string): Promise<WakeResult> {
  const res = await fetch(url, {
    method: "POST", redirect: "manual",
    headers: { "Content-Type": "application/json", ...headers },
    body, signal: AbortSignal.timeout(25_000),
  });
  const text = res.ok ? "" : (await res.text().catch(() => "")).slice(0, 2000);
  return { status: res.status, mitigated: res.headers.get("cf-mitigated"), body: text };
}

/** Same call sent from relay/wake-relay.mjs on a normal server; the relay only adds transport. */
async function viaRelay(relayUrl: string, relaySecret: string, url: string, headers: Record<string, string>, body: string): Promise<WakeResult> {
  const payload = JSON.stringify({ url, headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])), body });
  const ts = String(Math.floor(Date.now() / 1000));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(relaySecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${ts}.${payload}`)));
  const res = await fetch(relayUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Relay-Ts": ts, "X-Relay-Signature": [...mac].map((b) => b.toString(16).padStart(2, "0")).join("") },
    body: payload,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) return { status: 0, mitigated: null, body: "", error: `relay HTTP ${res.status}` };
  const j = (await res.json()) as Partial<WakeResult>;
  return { status: Number(j.status) || 0, mitigated: j.mitigated ?? null, body: String(j.body ?? ""), error: j.error };
}

export type WakeRecord = { at: number; ok: boolean; detail: string };

/** Last wake attempt per site, so the UI can say why queued jobs have not started. */
async function recordWake(env: CloudflareEnv, siteId: string, ok: boolean, detail: string) {
  const rec: WakeRecord = { at: Math.floor(Date.now() / 1000), ok, detail };
  await env.SESSIONPORTAL.put(`wake-last:${siteId}`, JSON.stringify(rec), { expirationTtl: 7 * 86400 }).catch(() => {});
}

export async function lastWake(env: CloudflareEnv, siteId: string): Promise<WakeRecord | null> {
  return (await env.SESSIONPORTAL.get(`wake-last:${siteId}`, "json").catch(() => null)) as WakeRecord | null;
}

const KIND_LABEL: Record<SiteJobKind, string> = { plugin: "ปลั๊กอิน", theme: "ธีม", core: "WordPress core" };

/**
 * Copies successful updates of a client's sites for (year, month) into a report
 * as maintenance tasks, once each. Returns how many tasks were added.
 */
export async function appendSiteUpdatesToReport(
  db: ReturnType<typeof createDB>,
  p: { clientId: string; reportId: string; year: number; month: number },
): Promise<number> {
  const from = Date.UTC(p.year, p.month - 1, 1) / 1000 - 7 * 3600;
  const to = Date.UTC(p.year, p.month, 1) / 1000 - 7 * 3600;
  const jobs = await db.listUnreportedSiteJobs(p.clientId, from, to);
  if (jobs.length === 0) return 0;
  const existing = await db.listTasksByReport(p.reportId);
  const seen = new Set(existing.map((t) => `${t.title}|${t.description ?? ""}`));
  let order = existing.length;
  for (const j of jobs) {
    const title = `อัปเดต${j.kind === "core" ? " WordPress" : `${KIND_LABEL[j.kind]} ${j.name}`} ${j.from_version ?? ""} → ${j.result_version ?? j.to_version ?? ""}`.replace(/\s+/g, " ").trim();
    const host = new URL(j.site_url).host;
    // The same update can finish twice (re-queued after a retry); list it once.
    if (seen.has(`${title}|${host}`)) continue;
    seen.add(`${title}|${host}`);
    await db.createReportTask({
      id: generateId(),
      report_id: p.reportId,
      category: j.kind === "core" ? "security" : "maintenance",
      title,
      description: host,
      completed: 1,
      sort_order: order++,
    });
  }
  await db.markSiteJobsReported(jobs.map((j) => j.id), Math.floor(Date.now() / 1000));
  await db.updateReport(p.reportId, { total_tasks: order });
  return jobs.length;
}

/** After a job succeeds: add it to this month's report, whether still a draft or already published. */
export async function addJobToDraftReport(env: CloudflareEnv, clientId: string, now: number): Promise<void> {
  const db = createDB(env.DB);
  const local = new Date((now + 7 * 3600) * 1000);
  const year = local.getUTCFullYear();
  const month = local.getUTCMonth() + 1;
  const report = await db.getReportByMonth(clientId, year, month);
  if (report) {
    await appendSiteUpdatesToReport(db, { clientId, reportId: report.id, year, month });
  }
}

/** Connected sites (clients and in-house) whose backups need attention. */
export async function listBackupProblems(env: CloudflareEnv, now = Math.floor(Date.now() / 1000)) {
  const { results } = await env.DB
    .prepare(
      `SELECT s.id, s.site_url, c.company_name, i.json FROM sites s
       JOIN clients c ON c.id = s.client_id
       JOIN site_inventory i ON i.site_id = s.id
       WHERE s.revoked_at IS NULL AND c.deleted_at IS NULL`
    )
    .all<{ id: string; site_url: string; company_name: string; json: string }>();
  const out: Array<{ site_id: string; host: string; company_name: string; issues: BackupIssue[] }> = [];
  for (const r of results) {
    let inv;
    try { inv = InventorySchema.safeParse(JSON.parse(r.json)); } catch { continue; }
    if (!inv.success) continue;
    const issues = backupIssues(inv.data, now);
    if (issues.length) out.push({ site_id: r.id, host: new URL(r.site_url).host, company_name: r.company_name, issues });
  }
  return out;
}

/** Pending updates per connected site (clients and in-house), with their level. */
export async function listPendingUpdatesBySite(env: CloudflareEnv) {
  const { results } = await env.DB
    .prepare(
      `SELECT s.site_url, i.json FROM sites s
       JOIN clients c ON c.id = s.client_id
       JOIN site_inventory i ON i.site_id = s.id
       WHERE s.revoked_at IS NULL AND c.deleted_at IS NULL`
    )
    .all<{ site_url: string; json: string }>();
  const out: Array<{ host: string; updates: PendingUpdate[] }> = [];
  for (const r of results) {
    let inv;
    try { inv = InventorySchema.safeParse(JSON.parse(r.json)); } catch { continue; }
    if (!inv.success) continue;
    const updates = pendingUpdates(inv.data);
    if (updates.length) out.push({ host: new URL(r.site_url).host, updates });
  }
  return out;
}
