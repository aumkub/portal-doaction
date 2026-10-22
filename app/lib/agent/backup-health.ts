import type { SiteInventory } from "./inventory";

/** A site whose newest backup is older than this needs attention. */
export const BACKUP_STALE_AFTER_S = 36 * 3600;

export type BackupIssue = "none" | "stale" | "failed" | "no_drive";

export const BACKUP_ISSUE_LABEL: Record<BackupIssue, string> = {
  none: "ไม่พบปลั๊กอิน backup",
  stale: "backup ใหม่ล่าสุดเก่าเกิน 36 ชม.",
  failed: "ตั้งเวลา backup ล้มในรอบล่าสุด",
  no_drive: "ไม่พบการส่ง backup ขึ้น Google Drive",
};

/**
 * Backup problems of one site, from what its plugin reported. Sites on a
 * plugin version that does not report backups yet (`backup` null) are not
 * judged.
 */
export function backupIssues(inv: Pick<SiteInventory, "backup"> | null, now: number): BackupIssue[] {
  const b = inv?.backup;
  if (!b) return [];
  if (b.sources.length === 0) return ["none"];
  const issues: BackupIssue[] = [];
  if (!b.last_at || now - b.last_at > BACKUP_STALE_AFTER_S) issues.push("stale");
  if (b.sources.some((s) => s.events.some((e) => e.enabled && e.last_status === "Failed"))) issues.push("failed");
  if (!b.sources.some((s) => s.remote.includes("googledrive"))) issues.push("no_drive");
  return issues;
}
