import { generateId } from "~/lib/utils";

/**
 * Telegram as a second way to approve a staff login, next to passkey/TOTP.
 *
 * Linking: the user enters their Telegram chat id, the bot sends a 6-digit
 * code there, and the user types it back, so only a chat they control can be
 * linked. Approving: the login page asks the bot to send a button that opens
 * /login/2fa/approve; a POST on that page marks the pending challenge approved
 * and the login tab, which polls, finishes signing in. Sending only (no
 * webhook), so the bot's other uses are unaffected.
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

async function send(env: CloudflareEnv, chatId: string, text: string, button?: { text: string; url: string }): Promise<string | null> {
  const token = await botToken(env);
  if (!token) return "ยังไม่ได้ตั้งค่า Telegram bot ของ portal";
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
      ...(button ? { reply_markup: { inline_keyboard: [[button]] } } : {}),
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

// ── Linking ────────────────────────────────────────────────────────────────

export async function startTelegramLink(env: CloudflareEnv, userId: string, chatIdRaw: string): Promise<string | null> {
  const chatId = chatIdRaw.trim();
  // Private chats only (positive ids); groups would let others approve.
  if (!/^\d{4,20}$/.test(chatId)) return "Chat ID ต้องเป็นตัวเลขของบัญชี Telegram ของคุณเอง (ไม่ใช่กลุ่ม)";
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0");
  const err = await send(env, chatId, `รหัสยืนยันการเชื่อม Telegram กับ do action portal: ${code}\n\nถ้าคุณไม่ได้ขอ ไม่ต้องทำอะไร`);
  if (err) return err;
  await env.SESSIONPORTAL.put(`tg-link:${userId}`, JSON.stringify({ chatId, codeHash: await sha256(code), attempts: 0 }), { expirationTtl: LINK_TTL });
  return null;
}

export async function confirmTelegramLink(env: CloudflareEnv, userId: string, code: string): Promise<string | null> {
  const key = `tg-link:${userId}`;
  const pending = await env.SESSIONPORTAL.get<{ chatId: string; codeHash: string; attempts: number }>(key, "json");
  if (!pending) return "หมดเวลา กรุณาส่งรหัสใหม่";
  if ((await sha256(code.trim())) !== pending.codeHash) {
    if (pending.attempts + 1 >= 5) await env.SESSIONPORTAL.delete(key);
    else await env.SESSIONPORTAL.put(key, JSON.stringify({ ...pending, attempts: pending.attempts + 1 }), { expirationTtl: LINK_TTL });
    return "รหัสไม่ถูกต้อง";
  }
  await env.SESSIONPORTAL.delete(key);
  await env.DB.prepare("UPDATE users SET telegram_chat_id = ?, updated_at = unixepoch() WHERE id = ?").bind(pending.chatId, userId).run();
  await send(env, pending.chatId, "เชื่อม Telegram กับ do action portal แล้ว — ใช้ยืนยันการเข้าสู่ระบบได้");
  return null;
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
  const err = await send(
    env,
    chatId,
    `มีการเข้าสู่ระบบ do action portal\nเวลา: ${when}\nIP: ${ip || "-"}\n\nถ้าเป็นคุณ กดปุ่มด้านล่างแล้วกด "ยืนยัน" (ใช้ได้ 5 นาที)\nถ้าไม่ใช่คุณ ไม่ต้องกด และควรเปลี่ยนรหัสผ่านอีเมล`,
    { text: "✅ ยืนยันการเข้าสู่ระบบ", url },
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
