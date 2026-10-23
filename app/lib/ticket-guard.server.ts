import type { Client } from "~/types";

/** New tickets a client may open before being asked to wait. */
const PER_HOUR = 5;
const PER_DAY = 15;

export type TicketGate = { ok: true } | { ok: false; reason: "blocked" | "rate"; message: string };

/**
 * Whether a client may open a new ticket now: not suspended by an admin and
 * under the hourly/daily caps (counted in D1, from every source: portal,
 * wp-admin widget).
 */
export async function ticketGate(env: CloudflareEnv, client: Pick<Client, "id" | "ticket_block">): Promise<TicketGate> {
  if (client.ticket_block) {
    return { ok: false, reason: "blocked", message: "การเปิด ticket ถูกระงับชั่วคราว กรุณาติดต่อทีม do action ทางอื่น" };
  }
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB
    .prepare(
      "SELECT SUM(created_at > ?) AS hour, COUNT(*) AS day FROM support_tickets WHERE client_id = ? AND created_at > ?"
    )
    .bind(now - 3600, client.id, now - 86400)
    .first<{ hour: number | null; day: number }>();
  if ((row?.hour ?? 0) >= PER_HOUR || (row?.day ?? 0) >= PER_DAY) {
    return { ok: false, reason: "rate", message: `เปิด ticket ได้ไม่เกิน ${PER_HOUR} เรื่องต่อชั่วโมง และ ${PER_DAY} เรื่องต่อวัน กรุณาเพิ่มรายละเอียดใน ticket เดิมแทน` };
  }
  return { ok: true };
}
