import {
  BACKUP_CACHE_KEY,
  filterBackupSnapshots,
  isBackupSnapshot,
  parseBackupTimestamp,
  type BackupEntry,
  type BackupResult,
} from "~/lib/backup";

export type { BackupEntry, BackupResult };

const ALLOWED_HOST = "cloud.aumwp.com";
const CACHE_KEY = BACKUP_CACHE_KEY;
const CACHE_TTL_SECONDS = 15 * 60; // 15 minutes

type WebDAVCredentials = { host: string; user: string; pass: string };

export async function getBackupList(
  env: {
    WEBDAV_HOST?: string;
    WEBDAV_USER?: string;
    WEBDAV_PASS?: string;
    WEBDAV_PATH?: string;
  },
  kv: KVNamespace,
  options?: { forceRefresh?: boolean }
): Promise<BackupResult> {
  if (!options?.forceRefresh) {
    const cached = await kv.get(CACHE_KEY, "json") as BackupResult | null;
    if (cached?.ok) {
      return { ...cached, fromCache: true };
    }
  }

  const fresh = await fetchBackupList(env);
  if (fresh.ok) {
    const payload = { ok: true as const, entries: fresh.entries, fetchedAt: fresh.fetchedAt };
    await kv.put(CACHE_KEY, JSON.stringify(payload), {
      expirationTtl: CACHE_TTL_SECONDS,
    });
    return { ...payload, fromCache: false };
  }
  return { ...fresh, fromCache: false };
}

export async function fetchBackupList(env: {
  WEBDAV_HOST?: string;
  WEBDAV_USER?: string;
  WEBDAV_PASS?: string;
  WEBDAV_PATH?: string;
}): Promise<{ ok: true; entries: BackupEntry[]; fetchedAt: number } | { ok: false; error: string }> {
  const host = (env.WEBDAV_HOST ?? ALLOWED_HOST).trim();
  const user = env.WEBDAV_USER?.trim();
  const pass = env.WEBDAV_PASS?.trim();
  const path = (env.WEBDAV_PATH ?? "/home/Backup").trim();

  if (host !== ALLOWED_HOST) {
    return { ok: false, error: "Domain mismatch — backup host not allowed" };
  }
  if (!user || !pass) {
    return { ok: false, error: "Backup credentials not configured" };
  }

  const creds: WebDAVCredentials = { host, user, pass };

  try {
    const xml = await propfind(creds, path);
    const sites = parseWebDAVXML(xml, path).filter((e) => e.isDirectory);

    if (sites.length > 0) {
      const enriched = await Promise.all(
        sites.map(async (site) => {
          const sitePath = `${path.replace(/\/$/, "")}/${site.name}`;
          try {
            const backups = await fetchBackupsInSite(creds, sitePath);
            const snapshots = filterBackupSnapshots(backups);
            const latest = snapshots[0]?.lastModified ?? site.lastModified;
            return {
              ...site,
              lastModified: latest,
              childCount: snapshots.length,
              children: snapshots,
            };
          } catch {
            return { ...site, childCount: 0, children: [] };
          }
        })
      );
      return { ok: true, entries: enriched, fetchedAt: Math.floor(Date.now() / 1000) };
    }

    const entries = parseWebDAVXML(xml, path);
    return { ok: true, entries, fetchedAt: Math.floor(Date.now() / 1000) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Connection failed" };
  }
}

/** List backup archives inside a site folder (level 2, or one level deeper if nested). */
async function fetchBackupsInSite(
  creds: WebDAVCredentials,
  sitePath: string
): Promise<BackupEntry[]> {
  const xml = await propfind(creds, sitePath);
  const level1 = parseWebDAVXML(xml, sitePath);
  const backups: BackupEntry[] = [];

  for (const item of level1) {
    if (isBackupSnapshot(item.name)) {
      backups.push({ ...item, relativePath: item.name });
      continue;
    }
    if (!item.isDirectory) continue;

    // Intermediate folder — list once for .wpress archive inside
    const subPath = `${sitePath.replace(/\/$/, "")}/${item.name}`;
    const subXml = await propfind(creds, subPath);
    const level2 = parseWebDAVXML(subXml, subPath);
    for (const sub of level2) {
      if (isBackupSnapshot(sub.name)) {
        backups.push({ ...sub, relativePath: `${item.name}/${sub.name}` });
      }
    }
  }

  return filterBackupSnapshots(backups).sort((a, b) => b.lastModified - a.lastModified);
}

async function propfind(creds: WebDAVCredentials, path: string): Promise<string> {
  const url = `https://${creds.host}${path.endsWith("/") ? path : path + "/"}`;
  const credentials = btoa(`${creds.user}:${creds.pass}`);

  const resp = await fetch(url, {
    method: "PROPFIND",
    headers: {
      Authorization: `Basic ${credentials}`,
      Depth: "1",
      "Content-Type": "application/xml; charset=utf-8",
    },
    body: `<?xml version="1.0" encoding="utf-8"?><propfind xmlns="DAV:"><prop><getlastmodified/><getcontentlength/><resourcetype/><displayname/></prop></propfind>`,
  });

  if (resp.status !== 207 && !resp.ok) {
    throw new Error(`WebDAV server returned HTTP ${resp.status}`);
  }
  return resp.text();
}

function parseWebDAVXML(xml: string, basePath: string): BackupEntry[] {
  const entries: BackupEntry[] = [];
  const normalizedBase = basePath.replace(/\/$/, "");

  const responseRx = /<[^:>]*:?response[^>]*>([\s\S]*?)<\/[^:>]*:?response>/gi;
  let match: RegExpExecArray | null;

  while ((match = responseRx.exec(xml)) !== null) {
    const block = match[1];

    const hrefMatch = block.match(/<[^:>]*:?href[^>]*>\s*([^<]+?)\s*<\/[^:>]*:?href>/i);
    if (!hrefMatch) continue;

    const href = decodeURIComponent(hrefMatch[1].trim()).replace(/\/$/, "");

    if (href === normalizedBase || href === normalizedBase + "/") continue;

    const name = href.split("/").filter(Boolean).pop() ?? href;
    const isDirectory = /<[^:>]*:?collection[^>]*>/i.test(block);

    const lmMatch = block.match(/<[^:>]*:?getlastmodified[^>]*>\s*([^<]+?)\s*<\/[^:>]*:?getlastmodified>/i);
    let lastModified = 0;
    if (lmMatch) {
      const d = new Date(lmMatch[1].trim());
      if (!isNaN(d.getTime())) lastModified = Math.floor(d.getTime() / 1000);
    }
    if (!lastModified) {
      const parsed = parseBackupTimestamp(name);
      if (parsed) lastModified = parsed;
    }

    const szMatch = block.match(/<[^:>]*:?getcontentlength[^>]*>\s*([^<]+?)\s*<\/[^:>]*:?getcontentlength>/i);
    const size = szMatch ? parseInt(szMatch[1].trim(), 10) || 0 : 0;

    entries.push({ name, lastModified, size, isDirectory });
  }

  return entries.sort((a, b) => b.lastModified - a.lastModified);
}
