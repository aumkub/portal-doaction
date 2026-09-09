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
const FAILURE_CACHE_TTL_SECONDS = 60;
const WEBDAV_TIMEOUT_MS = 8000;

type WebDAVCredentials = { host: string; user: string; pass: string };

export type WebDAVConfig = {
  url: string;
  username: string;
  password: string;
  path?: string;
};

/** Reads the WebDAV settings rows, returning null when it is off or unset. */
export async function readWebDAVConfig(
  db: { getAppSettings(keys: string[]): Promise<Record<string, string | null>> }
): Promise<WebDAVConfig | null> {
  const s = await db.getAppSettings([
    "webdav_enabled",
    "webdav_url",
    "webdav_username",
    "webdav_password",
    "webdav_path",
  ]);
  if (s.webdav_enabled === "0") return null;
  const { webdav_url: url, webdav_username: username, webdav_password: password } = s;
  if (!url || !username || !password) return null;
  return { url, username, password, path: s.webdav_path || "/home/Backup" };
}

export async function getBackupList(
  webdavConfig: WebDAVConfig | null,
  kv: KVNamespace,
  options?: { forceRefresh?: boolean; cacheOnly?: boolean }
): Promise<BackupResult> {
  if (!options?.forceRefresh) {
    const cached = await kv.get(CACHE_KEY, "json") as BackupResult | null;
    if (cached) {
      return { ...cached, fromCache: true };
    }
  }

  // The dashboard renders from cache only — reaching a possibly unresponsive
  // WebDAV host is left to the refresh action so it cannot block the page.
  if (options?.cacheOnly) {
    return { ok: false, error: "not_loaded", fromCache: false };
  }

  if (!webdavConfig) {
    return { ok: false, error: "WebDAV not configured in settings" };
  }

  const fresh = await fetchBackupList(webdavConfig);
  if (fresh.ok) {
    const payload = { ok: true as const, entries: fresh.entries, fetchedAt: fresh.fetchedAt };
    await kv.put(CACHE_KEY, JSON.stringify(payload), {
      expirationTtl: CACHE_TTL_SECONDS,
    });
    return { ...payload, fromCache: false };
  }
  // Without this, an unreachable WebDAV host makes every dashboard load pay
  // the full timeout again.
  await kv.put(CACHE_KEY, JSON.stringify(fresh), {
    expirationTtl: FAILURE_CACHE_TTL_SECONDS,
  });
  return { ...fresh, fromCache: false };
}

export async function fetchBackupList(
  webdavConfig: {
    url: string;
    username: string;
    password: string;
    path?: string;
  }
): Promise<{ ok: true; entries: BackupEntry[]; fetchedAt: number } | { ok: false; error: string }> {
  const { url, username, password, path = "/home/Backup" } = webdavConfig;
  const urlObj = new URL(url);
  const host = urlObj.host;
  const user = username.trim();
  const pass = password.trim();
  const basePath = path.trim();

  if (!user || !pass) {
    return { ok: false, error: "WebDAV credentials not configured" };
  }

  const creds: WebDAVCredentials = { host, user, pass };

  try {
    const xml = await propfind(creds, basePath);
    const sites = parseWebDAVXML(xml, basePath).filter((e) => e.isDirectory);

    if (sites.length > 0) {
      const enriched = await Promise.all(
        sites.map(async (site) => {
          const sitePath = `${basePath.replace(/\/$/, "")}/${site.name}`;
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

    const entries = parseWebDAVXML(xml, basePath);
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
    signal: AbortSignal.timeout(WEBDAV_TIMEOUT_MS),
  });

  if (resp.status !== 207 && !resp.ok) {
    throw new Error(`WebDAV server returned HTTP ${resp.status}: ${resp.statusText}`);
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
