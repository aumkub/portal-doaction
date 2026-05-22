export type BackupEntry = {
  name: string;
  lastModified: number;
  size: number;
  isDirectory: boolean;
  childCount?: number;
  children?: BackupEntry[];
};

export type BackupResult =
  | { ok: true; entries: BackupEntry[]; fetchedAt: number; fromCache: boolean }
  | { ok: false; error: string; fromCache?: boolean };

/** Backup status shown on the client dashboard (from cached admin sync). */
export const BACKUP_CACHE_KEY = "backup:list:v3";

/** True for All-in-One WP Migration archives (.wpress file or folder). */
export function isBackupSnapshot(name: string): boolean {
  return /\.wpress$/i.test(name);
}

/** Keep only real backup archives — excludes chunk/part files inside a backup folder. */
export function filterBackupSnapshots(entries: BackupEntry[]): BackupEntry[] {
  return entries.filter((e) => isBackupSnapshot(e.name));
}

export type ClientBackupView =
  | {
      ok: true;
      siteFolder: string;
      backups: BackupEntry[];
      backupCount: number;
      latest: BackupEntry | null;
      fetchedAt: number;
      fromCache: boolean;
    }
  | {
      ok: false;
      reason: "not_configured" | "cache_empty" | "site_not_found";
    };

/** Parse YYYYMMDD-HHMMSS from backup filename for display fallback */
export function parseBackupTimestamp(name: string): number | null {
  const m = name.match(/-(\d{8})-(\d{6})-/);
  if (!m) return null;
  const y = m[1].slice(0, 4);
  const mo = m[1].slice(4, 6);
  const d = m[1].slice(6, 8);
  const h = m[2].slice(0, 2);
  const mi = m[2].slice(2, 4);
  const s = m[2].slice(4, 6);
  const date = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}Z`);
  return isNaN(date.getTime()) ? null : Math.floor(date.getTime() / 1000);
}

/** Read cached backup list and return one client's mapped site (no WebDAV call). */
export async function getClientBackupFromCache(
  kv: KVNamespace,
  siteFolder: string | null | undefined
): Promise<ClientBackupView> {
  const folder = siteFolder?.trim();
  if (!folder) return { ok: false, reason: "not_configured" };

  const cached = await kv.get(BACKUP_CACHE_KEY, "json") as
    | { ok: true; entries: BackupEntry[]; fetchedAt: number }
    | null;

  if (!cached?.ok) return { ok: false, reason: "cache_empty" };

  const site = cached.entries.find((e) => e.name === folder);
  if (!site) return { ok: false, reason: "site_not_found" };

  const backups = filterBackupSnapshots(site.children ?? []);
  const latest = backups[0] ?? null;

  return {
    ok: true,
    siteFolder: folder,
    backups,
    backupCount: backups.length,
    latest,
    fetchedAt: cached.fetchedAt,
    fromCache: true,
  };
}
