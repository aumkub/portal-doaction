import type { DB } from "~/lib/db.server";
import { generateId, getThaiMonth } from "~/lib/utils";
import { sendTelegramNotificationForClient } from "~/lib/telegram.server";
import { syncReportSiteUpdates } from "~/lib/agent/jobs.server";
import { notifyReportToClient } from "~/lib/report-notify.server";

/** Draft → published, with the same in-app + Telegram notice as publishing from the editor. */
export async function publishReport(env: CloudflareEnv, db: DB, reportId: string): Promise<boolean> {
  const report = await db.getReport(reportId);
  if (!report) return false;
  if (report.status === "published") return true;
  await syncReportSiteUpdates(db, report);
  const tasks = await db.listTasksByReport(report.id);
  await db.updateReport(report.id, {
    status: "published",
    published_at: report.published_at ?? Math.floor(Date.now() / 1000),
    total_tasks: tasks.length,
  });
  const client = await db.getClientById(report.client_id);
  if (client) {
    const notification = {
      id: generateId(),
      user_id: client.user_id,
      type: "report_published",
      title: `รายงานประจำเดือน ${getThaiMonth(report.month)} ${report.year + 543} พร้อมแล้ว`,
      body: "ทีม do action ได้เผยแพร่รายงานสรุปงานสำหรับเดือนนี้แล้ว",
      link: `/reports/${report.id}`,
      read: 0,
    } as const;
    await db.createNotification(notification);
    await sendTelegramNotificationForClient({ db, appUrl: env.APP_URL, clientId: report.client_id, notification }).catch(() => {});
  }
  return true;
}

export async function unpublishReport(db: DB, reportId: string): Promise<boolean> {
  const report = await db.getReport(reportId);
  if (!report) return false;
  await db.updateReport(report.id, { status: "draft" });
  return true;
}

/**
 * Deletes a report and its tasks. Site updates of that month that it listed
 * become "unreported" again, so a report made later still picks them up.
 */
export async function deleteReport(env: CloudflareEnv, reportId: string): Promise<boolean> {
  const report = await env.DB.prepare("SELECT id, client_id, year, month FROM monthly_reports WHERE id = ?")
    .bind(reportId)
    .first<{ id: string; client_id: string; year: number; month: number }>();
  if (!report) return false;
  const from = Date.UTC(report.year, report.month - 1, 1) / 1000 - 7 * 3600;
  const to = Date.UTC(report.year, report.month, 1) / 1000 - 7 * 3600;
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE site_jobs SET reported_at = NULL
       WHERE reported_at IS NOT NULL AND finished_at >= ? AND finished_at < ?
         AND site_id IN (SELECT id FROM sites WHERE client_id = ?)`
    ).bind(from, to, report.client_id),
    env.DB.prepare("DELETE FROM report_tasks WHERE report_id = ?").bind(report.id),
    env.DB.prepare("DELETE FROM monthly_reports WHERE id = ?").bind(report.id),
  ]);
  return true;
}

export type BulkReportAction = "publish" | "publish_send" | "draft" | "delete";

export async function runBulkReportAction(opts: {
  env: CloudflareEnv; db: DB; origin: string; action: BulkReportAction; ids: string[];
}): Promise<{ ok: number; failed: { id: string; error: string }[] }> {
  const { env, db, origin, action, ids } = opts;
  let ok = 0;
  const failed: { id: string; error: string }[] = [];
  // One at a time: each publish/send makes notifications and emails.
  for (const id of ids) {
    try {
      if (action === "delete") {
        if (await deleteReport(env, id)) ok++; else failed.push({ id, error: "not_found" });
      } else if (action === "draft") {
        if (await unpublishReport(db, id)) ok++; else failed.push({ id, error: "not_found" });
      } else {
        if (!(await publishReport(env, db, id))) { failed.push({ id, error: "not_found" }); continue; }
        if (action === "publish") { ok++; continue; }
        const r = await notifyReportToClient({ env, db, reportId: id, origin });
        if (r.ok) ok++; else failed.push({ id, error: r.error });
      }
    } catch (e) {
      failed.push({ id, error: e instanceof Error ? e.message : "error" });
    }
  }
  return { ok, failed };
}
