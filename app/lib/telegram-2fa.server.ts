import { generateId } from "~/lib/utils";

/**
 * Telegram as a second way to approve a staff login, next to passkey/TOTP.
 *
 * Linking: the security page opens t.me/<bot>?start=<one-time code>; pressing
 * Start sends the code to our webhook, which links that private chat.
 * Approving: the 2FA page asks the bot to send "อนุมัติ / ไม่ใช่ฉัน" buttons;
 * a tap reaches the webhook (only from the linked chat counts) and the login
 * tab, which polls, signs in. If the webhook can't be set, the bot sends a
 * link to /login/2fa/approve instead.
 */

const LINK_TTL = 600;
const APPROVE_TTL = 300;
const RESEND_AFTER_S = 30;

async function botToken(env: CloudflareEnv): Promise<string | null> {
  const row = await env.DB.prepare("SELECT value FROM app_settings WHERE key = 'telegram_bot_token'").first<{ value: string }>();
  return row?.value?.trim() || null;
}

async function sha256(value: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}

type Button = { text: string; url?: string; callback_data?: string };

async function api(env: CloudflareEnv, method: string, body: unknown): Promise<{ ok?: boolean; description?: string } | null> {
  const token = await botToken(env);
  if (!token) return null;
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }).catch(() => null);
  return (await res?.json().catch(() => null)) as { ok?: boolean; description?: string } | null;
}

async function send(env: CloudflareEnv, chatId: string, text: string, buttons?: Button | Button[][]): Promise<string | null> {
  const token = await botToken(env);
  if (!token) return "ยังไม่ได้ตั้งค่า Telegram bot ของ portal";
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
      ...(buttons ? { reply_markup: { inline_keyboard: Array.isArray(buttons) ? buttons : [[buttons]] } } : {}),
    }),
  }).catch(() => null);
  const data = (await res?.json().catch(() => null)) as { ok?: boolean; description?: string } | null;
  if (data?.ok) return null;
  return /chat not found|bot was blocked|have no rights/i.test(data?.description ?? "")
    ? "ส่งข้อความไม่ได้ — เปิดแชตกับบอทของ portal แล้วกด Start ก่อน และตรวจ Chat ID อีกครั้ง"
    : "ส่งข้อความ Telegram ไม่สำเร็จ ลองอีกครั้ง";
}

export async function getTelegramChatId(env: CloudflareEnv, userId: string): Promise<string | null> {
  const row = await env.DB.prepare("SELECT telegram_chat_id FROM users WHERE id = ?").bind(userId).first<{ telegram_chat_id: string | null }>();
  return row?.telegram_chat_id ?? null;
}

/** Bot @username, for the "open the bot" link on the settings page. */
export async function getBotUsername(env: CloudflareEnv): Promise<string | null> {
  const cached = await env.SESSIONPORTAL.get("tg-bot-username");
  if (cached) return cached;
  const token = await botToken(env);
  if (!token) return null;
  const data = (await fetch(`https://api.telegram.org/bot${token}/getMe`).then((r) => r.json()).catch(() => null)) as { ok?: boolean; result?: { username?: string } } | null;
  const name = data?.ok ? data.result?.username ?? null : null;
  if (name) await env.SESSIONPORTAL.put("tg-bot-username", name, { expirationTtl: 86400 });
  return name;
}

// ── Webhook ────────────────────────────────────────────────────────────────

/** Secret Telegram echoes in X-Telegram-Bot-Api-Secret-Token; derived, so no extra setting. */
export async function webhookSecret(env: CloudflareEnv): Promise<string> {
  return (await sha256(`tg-webhook:${env.SESSION_SECRET}`)).slice(0, 48);
}

/** Points the bot's webhook at this portal (once a day at most). */
export async function ensureWebhook(env: CloudflareEnv, origin: string): Promise<boolean> {
  if (await env.SESSIONPORTAL.get("tg-webhook-set")) return true;
  const r = await api(env, "setWebhook", {
    url: `${origin}/api/telegram/webhook`,
    secret_token: await webhookSecret(env),
    allowed_updates: ["message", "callback_query"],
  });
  if (!r?.ok) return false;
  await env.SESSIONPORTAL.put("tg-webhook-set", "1", { expirationTtl: 86400 });
  return true;
}

// ── Linking ────────────────────────────────────────────────────────────────

/** One-time t.me deep link; pressing Start in Telegram links that chat to this user. */
export async function telegramLinkUrl(request: Request, env: CloudflareEnv, userId: string): Promise<string | null> {
  const bot = await getBotUsername(env);
  if (!bot || !(await ensureWebhook(env, new URL(request.url).origin))) return null;
  const code = generateId(24).replace(/[^A-Za-z0-9]/g, "").slice(0, 24);
  await env.SESSIONPORTAL.put(`tg-start:${code}`, userId, { expirationTtl: LINK_TTL });
  await env.SESSIONPORTAL.put(`tg-link:${userId}`, "1", { expirationTtl: LINK_TTL });
  return `https://t.me/${bot}?start=${code}`;
}

export async function hasPendingTelegramLink(env: CloudflareEnv, userId: string): Promise<boolean> {
  return Boolean(await env.SESSIONPORTAL.get(`tg-link:${userId}`));
}

export async function unlinkTelegram(env: CloudflareEnv, userId: string): Promise<void> {
  await env.DB.prepare("UPDATE users SET telegram_chat_id = NULL, updated_at = unixepoch() WHERE id = ?").bind(userId).run();
}

// ── Login approval ─────────────────────────────────────────────────────────

type ApprovalState = { status: "pending" | "approved"; nonce: string; sentAt: number };
type ApprovalRequest = { token: string; userId: string; ip: string; ua: string; at: number };

/** Sends the approve button for a pending login challenge. */
export async function sendLoginApproval(opts: {
  request: Request; env: CloudflareEnv; challengeToken: string; userId: string;
}): Promise<string | null> {
  const { request, env, challengeToken, userId } = opts;
  const chatId = await getTelegramChatId(env, userId);
  if (!chatId) return "บัญชีนี้ยังไม่ได้เชื่อม Telegram";
  const stateKey = `2fa-tg:${challengeToken}`;
  const prev = await env.SESSIONPORTAL.get<ApprovalState>(stateKey, "json");
  const now = Math.floor(Date.now() / 1000);
  if (prev && now - prev.sentAt < RESEND_AFTER_S) return null; // already sent a moment ago

  const nonce = generateId(32);
  const ip = request.headers.get("CF-Connecting-IP") ?? "";
  const ua = (request.headers.get("User-Agent") ?? "").slice(0, 160);
  const when = new Date(now * 1000).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" });
  const url = `${new URL(request.url).origin}/login/2fa/approve?n=${nonce}`;
  const webhook = await ensureWebhook(env, new URL(request.url).origin);
  const device = deviceLabel(ua);
  const err = await send(
    env,
    chatId,
    `มีการเข้าสู่ระบบ do action portal\n${when} · ${device} · IP ${ip || "-"}\n\nเป็นคุณไหม? (ใช้ได้ 5 นาที)`,
    webhook
      ? [[{ text: "✅ อนุมัติ", callback_data: `ok:${nonce}` }, { text: "ไม่ใช่ฉัน", callback_data: `no:${nonce}` }]]
      : { text: "✅ ยืนยันการเข้าสู่ระบบ", url },
  );
  if (err) return err;
  await env.SESSIONPORTAL.put(`2fa-tga:${nonce}`, JSON.stringify({ token: challengeToken, userId, ip, ua, at: now } satisfies ApprovalRequest), { expirationTtl: APPROVE_TTL });
  await env.SESSIONPORTAL.put(stateKey, JSON.stringify({ status: "pending", nonce, sentAt: now } satisfies ApprovalState), { expirationTtl: APPROVE_TTL });
  if (prev?.nonce) await env.SESSIONPORTAL.delete(`2fa-tga:${prev.nonce}`);
  return null;
}

export async function getApprovalRequest(env: CloudflareEnv, nonce: string): Promise<ApprovalRequest | null> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(nonce)) return null;
  return env.SESSIONPORTAL.get<ApprovalRequest>(`2fa-tga:${nonce}`, "json");
}

/** POST from the approve page. One use per link. */
export async function approveLogin(env: CloudflareEnv, nonce: string): Promise<boolean> {
  const req = await getApprovalRequest(env, nonce);
  if (!req) return false;
  await env.SESSIONPORTAL.delete(`2fa-tga:${nonce}`);
  const stateKey = `2fa-tg:${req.token}`;
  const state = await env.SESSIONPORTAL.get<ApprovalState>(stateKey, "json");
  if (!state || state.nonce !== nonce) return false; // superseded by a newer request
  await env.SESSIONPORTAL.put(stateKey, JSON.stringify({ ...state, status: "approved" }), { expirationTtl: APPROVE_TTL });
  // Remembered so reopening the link, a reload or a double tap shows "approved", not "expired".
  await env.SESSIONPORTAL.put(`2fa-tgd:${nonce}`, "1", { expirationTtl: APPROVE_TTL });
  return true;
}

export async function wasApproved(env: CloudflareEnv, nonce: string): Promise<boolean> {
  return /^[A-Za-z0-9_-]{16,64}$/.test(nonce) && Boolean(await env.SESSIONPORTAL.get(`2fa-tgd:${nonce}`));
}

/** Whether the pending challenge was approved in Telegram; consumes the approval. */
export async function takeApproval(env: CloudflareEnv, challengeToken: string): Promise<boolean> {
  const stateKey = `2fa-tg:${challengeToken}`;
  const state = await env.SESSIONPORTAL.get<ApprovalState>(stateKey, "json");
  if (state?.status !== "approved") return false;
  await env.SESSIONPORTAL.delete(stateKey);
  return true;
}

// ── Remembered devices (30 days without asking for 2FA) ────────────────────

export const TRUST_COOKIE = "doaction_trust";
const TRUST_TTL = 30 * 86400;

function readCookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get("Cookie") ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=") || null;
  }
  return null;
}

export async function isTrustedDevice(request: Request, env: CloudflareEnv, userId: string): Promise<boolean> {
  const raw = readCookie(request, TRUST_COOKIE);
  if (!raw) return false;
  const [uid, token] = raw.split(".");
  if (uid !== userId || !token) return false;
  return Boolean(await env.SESSIONPORTAL.get(`trust:${userId}:${await sha256(token)}`));
}

export async function trustDeviceCookie(request: Request, env: CloudflareEnv, userId: string): Promise<string> {
  const token = generateId(40);
  await env.SESSIONPORTAL.put(`trust:${userId}:${await sha256(token)}`, String(Math.floor(Date.now() / 1000)), { expirationTtl: TRUST_TTL });
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${TRUST_COOKIE}=${userId}.${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${TRUST_TTL}${secure}`;
}

export async function countTrustedDevices(env: CloudflareEnv, userId: string): Promise<number> {
  return (await env.SESSIONPORTAL.list({ prefix: `trust:${userId}:` })).keys.length;
}

export async function forgetTrustedDevices(env: CloudflareEnv, userId: string): Promise<void> {
  const { keys } = await env.SESSIONPORTAL.list({ prefix: `trust:${userId}:` });
  await Promise.all(keys.map((k) => env.SESSIONPORTAL.delete(k.name)));
}

export function deviceLabel(ua: string): string {
  const os = /iPhone|iPad/.test(ua) ? "iPhone/iPad" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "";
  return [browser, os].filter(Boolean).join(" บน ") || "ไม่ทราบอุปกรณ์";
}

type Update = {
  message?: { text?: string; chat?: { id?: number; type?: string } };
  callback_query?: { id: string; data?: string; from?: { id?: number }; message?: { chat?: { id?: number }; message_id?: number; text?: string } };
};

/** Telegram → portal: Start with a link code, or a tap on อนุมัติ / ไม่ใช่ฉัน. */
export async function handleTelegramWebhook(request: Request, env: CloudflareEnv): Promise<Response> {
  if (request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== (await webhookSecret(env))) {
    return new Response("forbidden", { status: 403 });
  }
  const update = (await request.json().catch(() => null)) as Update | null;

  const msg = update?.message;
  const start = msg?.text?.match(/^\/start\s+([A-Za-z0-9]{12,40})$/);
  if (msg?.chat?.id && msg.chat.type === "private" && start) {
    const userId = await env.SESSIONPORTAL.get(`tg-start:${start[1]}`);
    if (userId) {
      await env.SESSIONPORTAL.delete(`tg-start:${start[1]}`);
      await env.SESSIONPORTAL.delete(`tg-link:${userId}`);
      await env.DB.prepare("UPDATE users SET telegram_chat_id = ?, updated_at = unixepoch() WHERE id = ?").bind(String(msg.chat.id), userId).run();
      await send(env, String(msg.chat.id), "เชื่อม Telegram กับ do action portal แล้ว ✅\nต่อไปตอนเข้าสู่ระบบ กด \"อนุมัติ\" ในแชตนี้ได้เลย");
    } else {
      await send(env, String(msg.chat.id), "ลิงก์เชื่อมหมดอายุแล้ว กด \"เชื่อม Telegram\" ในหน้าความปลอดภัยบัญชีของ portal อีกครั้ง");
    }
    return new Response("ok");
  }

  const cq = update?.callback_query;
  const m = cq?.data?.match(/^(ok|no):([A-Za-z0-9_-]{16,64})$/);
  if (cq && m) {
    const answer = (text: string) => api(env, "answerCallbackQuery", { callback_query_id: cq.id, text });
    const edit = (text: string) => cq.message?.chat?.id && cq.message.message_id
      ? api(env, "editMessageText", { chat_id: cq.message.chat.id, message_id: cq.message.message_id, text })
      : null;
    const req = await getApprovalRequest(env, m[2]);
    if (!req) {
      await answer((await wasApproved(env, m[2])) ? "อนุมัติไปแล้ว" : "หมดอายุแล้ว");
      return new Response("ok");
    }
    // Only the chat linked to the account being signed in to may answer.
    if (String(cq.from?.id ?? "") !== ((await getTelegramChatId(env, req.userId)) ?? "-")) {
      await answer("ไม่ได้รับอนุญาต");
      return new Response("ok");
    }
    if (m[1] === "ok" && (await approveLogin(env, m[2]))) {
      await answer("อนุมัติแล้ว");
      await edit(`${cq.message?.text?.split("\n\n")[0] ?? "การเข้าสู่ระบบ"}\n\n✅ อนุมัติแล้ว`);
    } else {
      await env.SESSIONPORTAL.delete(`2fa-tga:${m[2]}`);
      await answer("ปฏิเสธแล้ว");
      await edit(`${cq.message?.text?.split("\n\n")[0] ?? "การเข้าสู่ระบบ"}\n\n⛔ ปฏิเสธแล้ว — ถ้าไม่ใช่คุณ ควรเปลี่ยนรหัสผ่านอีเมล`);
    }
  }
  return new Response("ok");
}
