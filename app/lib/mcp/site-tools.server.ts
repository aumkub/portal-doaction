import { z } from "zod";
import { clientSupportExpired } from "~/lib/contract";
import type { DB } from "~/lib/db.server";
import { InventorySchema, type SiteInventory } from "~/lib/agent/inventory";
import { pendingUpdates, updateLevel } from "~/lib/agent/update-level";
import { backupIssues, BACKUP_ISSUE_LABEL } from "~/lib/agent/backup-health";
import { familyRoot } from "~/lib/agent/families";
import { CARE_PAUSED_KEY, nextNightWindow, queueJobs, wakeSite, type JobRequest } from "~/lib/agent/jobs.server";
import { ToolError, type ToolContext } from "./tools.server";

/**
 * Remote site care over MCP: read site state and update history, and queue,
 * stop or wake updates. Every write needs `confirm: true`, which the
 * assistant may only set after the admin agreed to the exact list shown.
 */

const SILENT_AFTER_S = 3 * 3600;
const now = () => Math.floor(Date.now() / 1000);
const hostOf = (url: string) => new URL(url).host;

function parseInventory(json: string | null): SiteInventory | null {
  if (!json) return null;
  try {
    const r = InventorySchema.safeParse(JSON.parse(json));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

async function loadSites(db: DB) {
  return (await db.listAllSitesWithInventory()).map((r) => ({ row: r, inv: parseInventory(r.inventory_json) }));
}

/** Finds a site by id or by host ("conomi.co", "https://conomi.co"). */
async function mustFindSite(db: DB, site: string) {
  const all = await loadSites(db);
  const needle = site.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");
  const found = all.find((s) => s.row.id === site.trim())
    ?? all.find((s) => hostOf(s.row.site_url).toLowerCase().replace(/^www\./, "") === needle);
  if (!found) throw new ToolError(`Site ${site} not found (use list_sites for ids and hosts)`);
  return found;
}

function updatesOf(inv: SiteInventory) {
  const slugs = inv.plugins.map((p) => p.slug);
  return [
    ...(inv.core_update
      ? [{ kind: "core" as const, slug: "wordpress", name: "WordPress core", from: inv.wp_version, to: inv.core_update, level: updateLevel("core", inv.wp_version, inv.core_update), active: true, blocked: inv.core_update_blocked ?? null, family: null as string | null }]
      : []),
    ...inv.plugins.filter((p) => p.update_version).map((p) => {
      const root = familyRoot(p.slug, slugs);
      return { kind: "plugin" as const, slug: p.slug, name: p.name, from: p.version, to: p.update_version!, level: updateLevel("plugin", p.version, p.update_version!), active: p.active, blocked: p.update_blocked ?? null, family: root === p.slug && !slugs.some((s) => s !== p.slug && familyRoot(s, slugs) === p.slug) ? null : root };
    }),
    ...inv.themes.filter((t) => t.update_version).map((t) => ({
      kind: "theme" as const, slug: t.slug, name: t.name, from: t.version, to: t.update_version!, level: updateLevel("theme", t.version, t.update_version!), active: t.active, blocked: t.update_blocked ?? null, family: null as string | null,
    })),
  ];
}

function jobView(j: { id: string; site_url: string; kind: string; slug: string; name: string; from_version: string | null; to_version: string | null; result_version: string | null; status: string; created_at: number; started_at: number | null; finished_at: number | null; not_before: number; created_by_name: string | null }) {
  return {
    job_id: j.id, site: hostOf(j.site_url), kind: j.kind, slug: j.slug, name: j.name,
    from: j.from_version, to: j.to_version, result_version: j.result_version, status: j.status,
    queued_at: j.created_at, starts_after: j.not_before > j.created_at ? j.not_before : null,
    started_at: j.started_at, finished_at: j.finished_at, by: j.created_by_name ?? "system",
  };
}

const SiteRef = z.string().min(1).describe("Site id or host, e.g. conomi.co");
const Confirm = z.literal(true).describe("Must be true; only set after the admin confirmed this exact action in chat");

export function siteTools(tool: <S extends z.ZodObject>(def: {
  name: string; title: string; description: string; input: S; readOnly?: boolean; destructive?: boolean;
  run: (args: z.infer<S>, ctx: ToolContext) => Promise<unknown>;
}) => unknown) {
  return [
    tool({
      name: "list_sites",
      title: "List connected sites",
      description:
        "Every connected WordPress site: client, online state, WP/PHP and Do Action: Care plugin version, pending updates by level (major/minor/patch), backup problems and update jobs in progress.",
      input: z.object({}),
      readOnly: true,
      async run(_args, { db }) {
        const t = now();
        const jobs = await db.listSiteJobs({ since: t - 2 * 86400, limit: 500 });
        return (await loadSites(db)).map(({ row, inv }) => {
          const ups = inv ? pendingUpdates(inv) : [];
          const mine = jobs.filter((j) => j.site_id === row.id);
          return {
            site_id: row.id,
            host: hostOf(row.site_url),
            client: row.client_company,
            in_house: row.client_kind === "internal",
            support_expired: clientSupportExpired({ kind: row.client_kind, contract_end: row.client_contract_end }),
            online: !!row.last_seen_at && t - row.last_seen_at <= SILENT_AFTER_S,
            last_seen_at: row.last_seen_at,
            wp: inv?.wp_version ?? null,
            php: inv?.php_version ?? null,
            care_plugin: inv?.plugin_version ?? null,
            updates: {
              total: ups.length,
              major: ups.filter((u) => u.level === "major").length,
              minor: ups.filter((u) => u.level === "minor").length,
              patch: ups.filter((u) => u.level === "patch").length,
            },
            backup_issues: inv ? backupIssues(inv, t).map((i) => BACKUP_ISSUE_LABEL[i]) : [],
            jobs: { running: mine.filter((j) => j.status === "running").length, queued: mine.filter((j) => j.status === "queued").length },
          };
        });
      },
    }),

    tool({
      name: "get_site_updates",
      title: "Pending updates of a site",
      description:
        "Updates offered on one site with level (major/minor/patch), whether the plugin is active, why an update is blocked (PHP/WP too old), and `family`: a main plugin and its add-ons share a family and are always updated together. Use before queue_updates.",
      input: z.object({ site: SiteRef }),
      readOnly: true,
      async run({ site }, { db }) {
        const { row, inv } = await mustFindSite(db, site);
        if (!inv) throw new ToolError("This site hasn't sent its data yet");
        return {
          site_id: row.id, host: hostOf(row.site_url), wp: inv.wp_version, php: inv.php_version,
          file_mods_allowed: inv.file_mods_allowed, updates: updatesOf(inv),
        };
      },
    }),

    tool({
      name: "list_site_jobs",
      title: "Update history",
      description: "Update jobs (newest first) for one site or all sites: what, versions, status (queued/running/succeeded/rolled_back/failed/cancelled), who queued it. Logs are fetched with get_job_log.",
      input: z.object({
        site: SiteRef.optional(),
        days: z.number().int().min(1).max(90).default(7),
        status: z.enum(["queued", "running", "succeeded", "rolled_back", "failed", "cancelled"]).optional(),
        limit: z.number().int().min(1).max(300).default(100),
      }),
      readOnly: true,
      async run({ site, days, status, limit }, { db }) {
        const ids = site ? [(await mustFindSite(db, site)).row.id] : undefined;
        const jobs = await db.listSiteJobs({ site_ids: ids, since: now() - days * 86400, limit: 300 });
        return jobs.filter((j) => !status || j.status === status).slice(0, limit).map(jobView);
      },
    }),

    tool({
      name: "get_job_log",
      title: "Update job log",
      description: "The full log of one update job: checks before and after, backup, upgrader messages, rollback and any fatal error.",
      input: z.object({ job_id: z.string().min(1) }),
      readOnly: true,
      async run({ job_id }, { env }) {
        const row = await env.DB
          .prepare("SELECT j.*, s.site_url FROM site_jobs j JOIN sites s ON s.id = j.site_id WHERE j.id = ?")
          .bind(job_id)
          .first<{ site_url: string; name: string; status: string; from_version: string | null; to_version: string | null; result_version: string | null; log: string | null }>();
        if (!row) throw new ToolError(`Job ${job_id} not found`);
        return { site: hostOf(row.site_url), name: row.name, status: row.status, from: row.from_version, to: row.to_version, result_version: row.result_version, log: row.log ?? "" };
      },
    }),

    tool({
      name: "sites_needing_attention",
      title: "Sites needing attention",
      description: "Sites that need a person: silent over 3 hours, update failed or rolled back in the last 7 days, queue stopped because the site broke, backup problems, major updates waiting, expired support.",
      input: z.object({}),
      readOnly: true,
      async run(_args, { db }) {
        const t = now();
        const jobs = await db.listSiteJobs({ since: t - 7 * 86400, limit: 300 });
        const out = [];
        for (const { row, inv } of await loadSites(db)) {
          const reasons: string[] = [];
          if (!row.last_seen_at || t - row.last_seen_at > SILENT_AFTER_S) reasons.push("ขาดการติดต่อเกิน 3 ชม.");
          const mine = jobs.filter((j) => j.site_id === row.id);
          const failed = mine.filter((j) => j.status === "failed");
          const rolled = mine.filter((j) => j.status === "rolled_back");
          if (failed.length) reasons.push(`อัปเดตไม่สำเร็จ ${failed.length} รายการใน 7 วัน (${failed.slice(0, 3).map((j) => j.name).join(", ")})`);
          if (rolled.length) reasons.push(`พังแล้วย้อนกลับ ${rolled.length} รายการใน 7 วัน (${rolled.slice(0, 3).map((j) => j.name).join(", ")})`);
          if (inv) {
            for (const i of backupIssues(inv, t)) reasons.push(`backup: ${BACKUP_ISSUE_LABEL[i]}`);
            const majors = pendingUpdates(inv).filter((u) => u.level === "major");
            if (majors.length) reasons.push(`Major รออยู่ ${majors.length} รายการ (${majors.slice(0, 3).map((u) => `${u.name} ${u.from} → ${u.to}`).join(", ")})`);
          }
          if (clientSupportExpired({ kind: row.client_kind, contract_end: row.client_contract_end })) reasons.push("สัญญาดูแลหมดอายุ");
          if (reasons.length) out.push({ site_id: row.id, host: hostOf(row.site_url), client: row.client_company, reasons, failed_job_ids: failed.map((j) => j.id) });
        }
        return out;
      },
    }),

    tool({
      name: "queue_updates",
      title: "Queue site updates",
      description:
        "Queue updates on one site; the site backs up, updates, checks itself and rolls back on failure. Before calling, show the admin the exact items (name, from → to, level, now or night) and get explicit confirmation. Items must come from get_site_updates. A plugin's whole family must be included together. WordPress core cannot roll back automatically: say so before confirming.",
      input: z.object({
        site: SiteRef,
        items: z.array(z.object({ kind: z.enum(["plugin", "theme", "core"]), slug: z.string().min(1) })).min(1).max(100),
        when: z.enum(["now", "night"]).default("now").describe("night = 01:00–05:00 Bangkok"),
        confirm: Confirm,
      }),
      destructive: true,
      async run({ site, items, when }, { env, db, user }) {
        if (await env.SESSIONPORTAL.get(CARE_PAUSED_KEY)) throw new ToolError("Remote updates are stopped (stop-all switch on /admin/sites)");
        const { row, inv } = await mustFindSite(db, site);
        if (!row.last_seen_at || now() - row.last_seen_at > SILENT_AFTER_S) throw new ToolError("The site has been silent over 3 hours; updates can't be queued");
        if (!inv) throw new ToolError("This site hasn't sent its data yet");
        if (!inv.file_mods_allowed) throw new ToolError("File changes are disabled on this site (DISALLOW_FILE_MODS / FS_METHOD)");
        const client = await db.getClientById(row.client_id);
        if (client && clientSupportExpired(client)) throw new ToolError("The client's support has expired");

        const offered = updatesOf(inv);
        const unknown = items.filter((i) => !offered.some((o) => o.kind === i.kind && o.slug === i.slug));
        if (unknown.length) throw new ToolError(`Not offered on this site: ${unknown.map((i) => i.slug).join(", ")} (use get_site_updates)`);
        const blocked = offered.filter((o) => o.blocked && items.some((i) => i.kind === o.kind && i.slug === o.slug));
        if (blocked.length) throw new ToolError(`Blocked: ${blocked.map((o) => `${o.name} (${o.blocked})`).join("; ")}`);
        const families = new Set(offered.filter((o) => o.family && items.some((i) => i.kind === "plugin" && i.slug === o.slug)).map((o) => o.family));
        const missing = offered.filter((o) => o.family && families.has(o.family) && !o.blocked && !items.some((i) => i.kind === "plugin" && i.slug === o.slug));
        if (missing.length) {
          throw new ToolError(`A plugin and its add-ons update together; also confirm and include: ${missing.map((o) => `${o.name} ${o.from} → ${o.to} (${o.slug})`).join(", ")}`);
        }

        const notBefore = when === "night" ? nextNightWindow(now()) : 0;
        const queued = await queueJobs({ env, siteId: row.id, inventory: inv, items: items as JobRequest[], userId: user.id, notBefore });
        if (queued === 0) throw new ToolError("Nothing queued (already queued or running)");
        if (when === "now") await wakeSite(env, row, inv.home_url);
        return { ok: true, queued, site: hostOf(row.site_url), starts: when === "night" ? notBefore : "now" };
      },
    }),

    tool({
      name: "stop_site",
      title: "Stop a site's queued updates",
      description: "Cancel every queued update of one site. A job already running finishes (and rolls back if the site breaks). Confirm with the admin first.",
      input: z.object({ site: SiteRef, confirm: Confirm }),
      destructive: true,
      async run({ site }, { db }) {
        const { row } = await mustFindSite(db, site);
        const cancelled = await db.cancelQueuedSiteJobsForSite(row.id, "หยุดโดยแอดมิน (MCP)");
        return { ok: true, site: hostOf(row.site_url), cancelled };
      },
    }),

    tool({
      name: "wake_site",
      title: "Wake a site",
      description: "Ask a site to send fresh data and pick up its queued jobs now instead of at its next check-in. At most once a minute per site. Confirm with the admin first.",
      input: z.object({ site: SiteRef, confirm: Confirm }),
      async run({ site }, { env, db }) {
        const { row, inv } = await mustFindSite(db, site);
        const rlKey = `wake-rl:${row.id}`;
        if (await env.SESSIONPORTAL.get(rlKey)) throw new ToolError("Woken less than a minute ago; try again shortly");
        await env.SESSIONPORTAL.put(rlKey, "1", { expirationTtl: 60 });
        const ok = await wakeSite(env, row, inv?.home_url ?? row.site_url);
        return { ok, site: hostOf(row.site_url), note: ok ? "Woken; fresh data in a few seconds" : "The site did not answer; it will check in on its own schedule" };
      },
    }),
  ];
}
