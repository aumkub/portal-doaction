import { createDB } from "~/lib/db.server";
import { readWebDAVConfig } from "~/lib/backup.server";
import { getUptimeRobotKey } from "~/lib/secrets.server";

/**
 * Connection checks for the settings page. Each check is read-only: it
 * proves a binding or external service answers, without changing anything
 * or sending messages to anyone.
 */

export type HealthCheckId =
  | "d1"
  | "kv"
  | "r2"
  | "email"
  | "session_secret"
  | "uptimerobot"
  | "telegram"
  | "webdav";

export interface HealthResult {
  id: HealthCheckId;
  status: "ok" | "warn" | "fail";
  detail: string;
  ms: number;
}

const TIMEOUT_MS = 8000;

function withTimeout(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
}

type Outcome = Omit<HealthResult, "id" | "ms">;

const CHECKS: Record<HealthCheckId, (env: CloudflareEnv) => Promise<Outcome>> = {
  async d1(env) {
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM clients").first<{ n: number }>();
    return { status: "ok", detail: `ตอบกลับปกติ · ลูกค้า ${row?.n ?? 0} ราย` };
  },

  async kv(env) {
    // A read is enough to prove the namespace answers; no write needed.
    await env.SESSIONPORTAL.get("health:probe");
    return { status: "ok", detail: "อ่านข้อมูลได้ปกติ" };
  },

  async r2(env) {
    const list = await env.ATTACHMENTS.list({ limit: 1 });
    return { status: "ok", detail: list.objects.length ? "เข้าถึงไฟล์แนบได้" : "เข้าถึงได้ (ยังไม่มีไฟล์)" };
  },

  async email(env) {
    // Sending a test would reach a real inbox, so only confirm the binding.
    if (!env.SEND_EMAIL) return { status: "fail", detail: "ไม่พบ binding SEND_EMAIL" };
    const db = createDB(env.DB);
    const [last] = await db.listEmailLogs(1);
    if (!last) return { status: "warn", detail: "ตั้งค่าแล้ว แต่ยังไม่เคยส่งอีเมล" };
    return last.status === "sent"
      ? { status: "ok", detail: "ตั้งค่าแล้ว · อีเมลล่าสุดส่งสำเร็จ" }
      : { status: "warn", detail: `อีเมลล่าสุดส่งไม่สำเร็จ: ${last.error_message ?? "ไม่ทราบสาเหตุ"}` };
  },

  async session_secret(env) {
    return env.SESSION_SECRET
      ? { status: "ok", detail: "ตั้งค่าแล้ว (ใช้เซ็นลิงก์รายงาน)" }
      : { status: "fail", detail: "ยังไม่ได้ตั้ง — ลิงก์รายงานจะใช้ไม่ได้" };
  },

  async uptimerobot(env) {
    const key = getUptimeRobotKey(env);
    if (!key) return { status: "fail", detail: "ยังไม่ได้ตั้ง UPTIMEROBOT_API_KEY" };
    // getMonitors is the call the portal really makes, and the one a
    // read-only key may use (getAccountDetails needs a main key).
    const res = await withTimeout("https://api.uptimerobot.com/v2/getMonitors", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ api_key: key, format: "json" }).toString(),
    });
    const data = (await res.json().catch(() => null)) as
      | { stat?: string; monitors?: Array<{ status?: number; friendly_name?: string }>; error?: { message?: string } }
      | null;
    if (data?.stat !== "ok") return { status: "fail", detail: data?.error?.message ?? `HTTP ${res.status}` };
    const monitors = data.monitors ?? [];
    // UptimeRobot status: 8 = seems down, 9 = down.
    const down = monitors.filter((m) => m.status === 8 || m.status === 9);
    if (monitors.length === 0) return { status: "warn", detail: "เชื่อมต่อได้ แต่ยังไม่มี monitor" };
    return down.length > 0
      ? {
          status: "warn",
          detail: `เชื่อมต่อได้ · เว็บล่ม ${down.length} จาก ${monitors.length} เว็บ (${down
            .map((m) => m.friendly_name)
            .filter(Boolean)
            .join(", ")})`,
        }
      : { status: "ok", detail: `เชื่อมต่อได้ · ทุกเว็บออนไลน์ (${monitors.length} เว็บ)` };
  },

  async telegram(env) {
    const db = createDB(env.DB);
    const token = await db.getAppSetting("telegram_bot_token");
    if (!token) return { status: "warn", detail: "ยังไม่ได้ตั้ง Bot Token" };
    const res = await withTimeout(`https://api.telegram.org/bot${token}/getMe`);
    const data = (await res.json().catch(() => null)) as
      | { ok?: boolean; result?: { username?: string }; description?: string }
      | null;
    return data?.ok
      ? { status: "ok", detail: `เชื่อมต่อได้ · @${data.result?.username ?? "bot"}` }
      : { status: "fail", detail: data?.description ?? `HTTP ${res.status}` };
  },

  async webdav(env) {
    const cfg = await readWebDAVConfig(createDB(env.DB));
    if (!cfg) return { status: "warn", detail: "ปิดอยู่หรือยังตั้งค่าไม่ครบ" };
    const res = await withTimeout(cfg.url, {
      method: "PROPFIND",
      headers: { Authorization: `Basic ${btoa(`${cfg.username}:${cfg.password}`)}`, Depth: "0" },
    });
    return res.ok || res.status === 207
      ? { status: "ok", detail: "เชื่อมต่อเซิร์ฟเวอร์ Backup ได้" }
      : { status: "fail", detail: `HTTP ${res.status} ${res.statusText}`.trim() };
  },
};

export const HEALTH_CHECK_IDS = Object.keys(CHECKS) as HealthCheckId[];

export function isHealthCheckId(value: string): value is HealthCheckId {
  return value in CHECKS;
}

export async function runHealthCheck(env: CloudflareEnv, id: HealthCheckId): Promise<HealthResult> {
  const started = Date.now();
  try {
    const outcome = await CHECKS[id](env);
    return { id, ...outcome, ms: Date.now() - started };
  } catch (e) {
    const message = e instanceof Error ? (e.name === "TimeoutError" ? "หมดเวลารอการตอบกลับ" : e.message) : String(e);
    return { id, status: "fail", detail: message, ms: Date.now() - started };
  }
}
