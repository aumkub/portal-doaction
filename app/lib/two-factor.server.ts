import { redirect } from "react-router";
import { renderSVG } from "uqr";
import { createAuth, evictUserCache } from "~/lib/auth.server";
import { generateId } from "~/lib/utils";
import {
  buildOtpauthUri,
  decryptSecret,
  encryptSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  verifyTotp,
} from "~/lib/totp.server";
import {
  finishPasskeyRegistration,
  listPasskeys,
  startPasskeyAuthentication,
  startPasskeyRegistration,
  verifyPasskeyAssertion,
} from "~/lib/passkey.server";
import type { TwoFactorMethod, User } from "~/types";
import { forgetTrustedDevices, isTrustedDevice, takeApproval, trustDeviceCookie } from "~/lib/telegram-2fa.server";

const CHALLENGE_TTL = 300;
const SETUP_TTL = 600;
const MAX_ATTEMPTS = 5;
export const TWO_FACTOR_COOKIE = "doaction_2fa";

interface TotpRow {
  totp_secret: string | null;
  totp_enabled_at: number | null;
  totp_recovery: string | null;
  two_factor_method: TwoFactorMethod | null;
}

interface Challenge {
  userId: string;
  redirect: string;
  attempts: number;
  method: TwoFactorMethod;
}

export type ChallengeMethod = "totp" | "recovery" | "passkey";

export function safeRedirect(dest: string | null | undefined, fallback: string): string {
  if (!dest || !dest.startsWith("/") || dest.startsWith("//") || dest.startsWith("/\\")) {
    return fallback;
  }
  return dest;
}

export async function getTotpRow(d1: D1Database, userId: string): Promise<TotpRow | null> {
  return d1
    .prepare("SELECT totp_secret, totp_enabled_at, totp_recovery, two_factor_method FROM users WHERE id = ?")
    .bind(userId)
    .first<TotpRow>();
}

function isSecure(request: Request) {
  return new URL(request.url).protocol === "https:";
}

function challengeCookie(request: Request, token: string, maxAge: number) {
  return `${TWO_FACTOR_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${
    isSecure(request) ? "; Secure" : ""
  }`;
}

export function readChallengeToken(request: Request): string | null {
  const header = request.headers.get("Cookie") ?? "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === TWO_FACTOR_COOKIE) return v.join("=") || null;
  }
  return null;
}

/**
 * Creates the session — or, when the user has 2FA on, parks the login in a
 * short-lived KV challenge and sends them to /login/2fa.
 */
export async function completeLogin(opts: {
  request: Request;
  env: CloudflareEnv;
  user: Pick<User, "id" | "role">;
  redirectTo: string;
}): Promise<Response> {
  const { request, env, user, redirectTo } = opts;
  const row = await getTotpRow(env.DB, user.id);
  const method = activeMethod(row);
  // A device the user chose to remember skips 2FA for 30 days.
  if (method && !(await isTrustedDevice(request, env, user.id))) {
    const token = generateId(32);
    await env.SESSIONPORTAL.put(
      `2fa:${token}`,
      JSON.stringify({ userId: user.id, redirect: redirectTo, attempts: 0, method } satisfies Challenge),
      { expirationTtl: CHALLENGE_TTL }
    );
    return redirect("/login/2fa", {
      headers: { "Set-Cookie": challengeCookie(request, token, CHALLENGE_TTL) },
    });
  }
  const { lucia } = createAuth(env.DB, env.SESSIONPORTAL);
  const session = await lucia.createSession(user.id, {});
  return redirect(redirectTo, {
    headers: { "Set-Cookie": lucia.createSessionCookie(session.id).serialize() },
  });
}

export async function getChallenge(env: CloudflareEnv, request: Request) {
  const token = readChallengeToken(request);
  if (!token) return null;
  const data = await env.SESSIONPORTAL.get<Challenge>(`2fa:${token}`, "json");
  return data ? { token, data } : null;
}

function clearCookieHeader(request: Request) {
  return challengeCookie(request, "", 0);
}

/** The user's configured second factor; rows enabled before 0018 count as TOTP. */
function activeMethod(row: TotpRow | null): TwoFactorMethod | null {
  if (!row) return null;
  if (row.two_factor_method === "passkey") return "passkey";
  if (row.totp_enabled_at && row.totp_secret) return "totp";
  return null;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Spends one recovery code. Works for either method. */
async function consumeRecoveryCode(env: CloudflareEnv, userId: string, row: TotpRow, code: string) {
  const hashes: string[] = row.totp_recovery ? JSON.parse(row.totp_recovery) : [];
  const hash = await hashRecoveryCode(code);
  let match = false;
  for (const h of hashes) if (timingSafeEqual(h, hash)) match = true;
  if (!match) return false;
  const remaining = hashes.filter((h) => h !== hash);
  // Conditional update so a code cannot be spent twice by racing requests.
  const res = await env.DB.prepare(
    "UPDATE users SET totp_recovery = ?, updated_at = unixepoch() WHERE id = ? AND totp_recovery = ?"
  )
    .bind(JSON.stringify(remaining), userId, row.totp_recovery)
    .run();
  if (!res.meta.changes) return false;
  await evictUserCache(env.SESSIONPORTAL, userId);
  return true;
}

/** Verifies a TOTP code, passkey assertion or recovery code against the user's factor. */
async function checkSecondFactor(
  request: Request,
  env: CloudflareEnv,
  userId: string,
  kind: ChallengeMethod,
  code: string,
  passkeyChallengeKey: string
): Promise<boolean> {
  const row = await getTotpRow(env.DB, userId);
  const method = activeMethod(row);
  if (!row || !method) return false;
  if (kind === "recovery") return consumeRecoveryCode(env, userId, row, code);
  if (kind !== method) return false;
  if (method === "totp") {
    const secret = await decryptSecret(row.totp_secret!, env.SESSION_SECRET);
    return verifyTotp(secret, code);
  }
  return verifyPasskeyAssertion(request, env, userId, passkeyChallengeKey, code);
}

/** Passkey request options for the pending login challenge. */
export async function loginPasskeyOptions(request: Request, env: CloudflareEnv) {
  const challenge = await getChallenge(env, request);
  if (!challenge || challenge.data.method !== "passkey") return null;
  return startPasskeyAuthentication(request, env, challenge.data.userId, `2fa-pk:${challenge.token}`);
}

/** Second factor passed: start the session, optionally remembering this device for 30 days. */
async function finishChallenge(request: Request, env: CloudflareEnv, token: string, data: Challenge, remember: boolean): Promise<Response> {
  await env.SESSIONPORTAL.delete(`2fa:${token}`);
  const { lucia } = createAuth(env.DB, env.SESSIONPORTAL);
  const session = await lucia.createSession(data.userId, {});
  const headers = new Headers();
  headers.append("Set-Cookie", lucia.createSessionCookie(session.id).serialize());
  headers.append("Set-Cookie", clearCookieHeader(request));
  if (remember) headers.append("Set-Cookie", await trustDeviceCookie(request, env, data.userId));
  return redirect(safeRedirect(data.redirect, "/admin"), { headers });
}

/** Login page polling: signs in once the login was approved in Telegram. */
export async function finishTelegramChallenge(request: Request, env: CloudflareEnv, remember: boolean): Promise<Response | { pending: true }> {
  const challenge = await getChallenge(env, request);
  if (!challenge) return redirect("/login?error=2fa_expired", { headers: { "Set-Cookie": clearCookieHeader(request) } });
  if (!(await takeApproval(env, challenge.token))) return { pending: true };
  return finishChallenge(request, env, challenge.token, challenge.data, remember);
}

export async function verifyChallenge(opts: {
  request: Request;
  env: CloudflareEnv;
  code: string;
  kind: ChallengeMethod;
  remember?: boolean;
}): Promise<Response | { error: string }> {
  const { request, env, code, kind, remember = false } = opts;
  const challenge = await getChallenge(env, request);
  if (!challenge) {
    return redirect("/login?error=2fa_expired", {
      headers: { "Set-Cookie": clearCookieHeader(request) },
    });
  }
  const { token, data } = challenge;
  const ok = await checkSecondFactor(request, env, data.userId, kind, code, `2fa-pk:${token}`);
  if (!ok) {
    const attempts = data.attempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      await env.SESSIONPORTAL.delete(`2fa:${token}`);
      return redirect("/login?error=2fa_locked", {
        headers: { "Set-Cookie": clearCookieHeader(request) },
      });
    }
    await env.SESSIONPORTAL.put(`2fa:${token}`, JSON.stringify({ ...data, attempts }), {
      expirationTtl: CHALLENGE_TTL,
    });
    return { error: kind === "passkey" ? "ยืนยันด้วย passkey ไม่สำเร็จ กรุณาลองอีกครั้ง" : "รหัสไม่ถูกต้อง กรุณาลองอีกครั้ง" };
  }
  return finishChallenge(request, env, token, data, remember);
}

// ─── Enrollment / management (settings page) ────────────────────────────────

export interface TwoFactorState {
  enabled: boolean;
  method: TwoFactorMethod | null;
  enabledAt: number | null;
  recoveryRemaining: number;
  setup: { secret: string; qrSvg: string } | null;
  passkeys: { id: string; name: string | null; createdAt: number; lastUsedAt: number | null }[];
}

export async function loadTwoFactorState(
  env: CloudflareEnv,
  user: Pick<User, "id" | "email">
): Promise<TwoFactorState> {
  const row = await getTotpRow(env.DB, user.id);
  const method = activeMethod(row);
  let setup: TwoFactorState["setup"] = null;
  if (!method) {
    const pending = await env.SESSIONPORTAL.get(`2fa-setup:${user.id}`);
    if (pending) {
      const secret = await decryptSecret(pending, env.SESSION_SECRET);
      setup = {
        secret,
        qrSvg: renderSVG(buildOtpauthUri(secret, user.email), { border: 1 }),
      };
    }
  }
  const recovery: string[] = row?.totp_recovery ? JSON.parse(row.totp_recovery) : [];
  const passkeys = method === "passkey" ? await listPasskeys(env.DB, user.id) : [];
  return {
    enabled: Boolean(method),
    method,
    enabledAt: method === "totp" ? (row?.totp_enabled_at ?? null) : null,
    recoveryRemaining: method ? recovery.length : 0,
    setup,
    passkeys: passkeys.map((pk) => ({
      id: pk.id,
      name: pk.name,
      createdAt: pk.created_at,
      lastUsedAt: pk.last_used_at,
    })),
  };
}

export type TwoFactorActionResult = {
  twoFactor: {
    error?: string;
    recoveryCodes?: string[];
    message?: string;
    passkeyOptions?: unknown;
    passkeyAuthOptions?: unknown;
  };
} | null;

async function newRecoveryHashes() {
  const codes = generateRecoveryCodes();
  const hashes = await Promise.all(codes.map(hashRecoveryCode));
  return { codes, hashes };
}

/** Handles `2fa_*` / `pk_*` intents; returns null for any other intent. */
export async function handleTwoFactorIntent(
  request: Request,
  env: CloudflareEnv,
  user: Pick<User, "id" | "email" | "name">,
  intent: string,
  formData: FormData
): Promise<TwoFactorActionResult> {
  if (!intent.startsWith("2fa_") && !intent.startsWith("pk_")) return null;
  const code = String(formData.get("code") ?? "").trim();
  const invalid = { twoFactor: { error: "รหัสไม่ถูกต้อง กรุณาลองอีกครั้ง" } };
  const setupKey = `2fa-setup:${user.id}`;
  const row = await getTotpRow(env.DB, user.id);
  const method = activeMethod(row);

  if (intent === "2fa_start") {
    if (method) return { twoFactor: { error: "เปิดใช้ 2FA อยู่แล้ว" } };
    const encrypted = await encryptSecret(generateTotpSecret(), env.SESSION_SECRET);
    await env.SESSIONPORTAL.put(setupKey, encrypted, { expirationTtl: SETUP_TTL });
    return { twoFactor: {} };
  }

  if (intent === "2fa_cancel") {
    await env.SESSIONPORTAL.delete(setupKey);
    return { twoFactor: {} };
  }

  if (intent === "2fa_confirm") {
    if (method) return { twoFactor: { error: "เปิดใช้ 2FA อยู่แล้ว" } };
    const pending = await env.SESSIONPORTAL.get(setupKey);
    if (!pending) return { twoFactor: { error: "หมดเวลาตั้งค่า กรุณาเริ่มใหม่" } };
    const secret = await decryptSecret(pending, env.SESSION_SECRET);
    if (!(await verifyTotp(secret, code))) return invalid;
    const { codes, hashes } = await newRecoveryHashes();
    await env.DB.prepare(
      "UPDATE users SET totp_secret = ?, totp_enabled_at = unixepoch(), totp_recovery = ?, two_factor_method = 'totp', updated_at = unixepoch() WHERE id = ?"
    )
      .bind(pending, JSON.stringify(hashes), user.id)
      .run();
    await env.SESSIONPORTAL.delete(setupKey);
    await evictUserCache(env.SESSIONPORTAL, user.id);
    return { twoFactor: { recoveryCodes: codes, message: "เปิดใช้ 2FA แล้ว" } };
  }

  // ─── Passkey enrolment ────────────────────────────────────────────────────
  if (intent === "pk_reg_options") {
    if (method === "totp") return { twoFactor: { error: "ปิด 2FA แบบแอปก่อนเปลี่ยนเป็น passkey" } };
    return { twoFactor: { passkeyOptions: await startPasskeyRegistration(request, env, user) } };
  }

  if (intent === "pk_reg_verify") {
    if (method === "totp") return { twoFactor: { error: "ปิด 2FA แบบแอปก่อนเปลี่ยนเป็น passkey" } };
    const name = String(formData.get("name") ?? "").trim();
    const ok = await finishPasskeyRegistration(
      request, env, user.id, String(formData.get("response") ?? ""), name
    );
    if (!ok) return { twoFactor: { error: "บันทึก passkey ไม่สำเร็จ กรุณาลองอีกครั้ง" } };
    if (method === "passkey") return { twoFactor: { message: "เพิ่ม passkey แล้ว" } };
    const { codes, hashes } = await newRecoveryHashes();
    await env.DB.prepare(
      "UPDATE users SET two_factor_method = 'passkey', totp_secret = NULL, totp_enabled_at = NULL, totp_recovery = ?, updated_at = unixepoch() WHERE id = ?"
    )
      .bind(JSON.stringify(hashes), user.id)
      .run();
    await env.SESSIONPORTAL.delete(setupKey);
    await evictUserCache(env.SESSIONPORTAL, user.id);
    return { twoFactor: { recoveryCodes: codes, message: "เปิดใช้ 2FA ด้วย passkey แล้ว" } };
  }

  if (!row || !method) return { twoFactor: { error: "ยังไม่ได้เปิดใช้ 2FA" } };

  if (intent === "pk_auth_options") {
    if (method !== "passkey") return { twoFactor: { error: "คำขอไม่ถูกต้อง" } };
    const options = await startPasskeyAuthentication(request, env, user.id, `pk-auth:${user.id}`);
    if (!options) return { twoFactor: { error: "ไม่พบ passkey" } };
    return { twoFactor: { passkeyAuthOptions: options } };
  }

  if (intent === "pk_remove") {
    if (method !== "passkey") return { twoFactor: { error: "คำขอไม่ถูกต้อง" } };
    const passkeys = await listPasskeys(env.DB, user.id);
    if (passkeys.length <= 1) {
      return { twoFactor: { error: "ลบ passkey สุดท้ายไม่ได้ — ใช้ “ปิด 2FA / เปลี่ยนวิธี” แทน" } };
    }
    const res = await env.DB.prepare("DELETE FROM user_passkeys WHERE id = ? AND user_id = ?")
      .bind(String(formData.get("passkey_id") ?? ""), user.id)
      .run();
    if (!res.meta.changes) return { twoFactor: { error: "ไม่พบ passkey" } };
    return { twoFactor: { message: "ลบ passkey แล้ว" } };
  }

  // Remaining intents need proof of the current factor (or a recovery code).
  const recovery = String(formData.get("recovery") ?? "").trim();
  const assertion = String(formData.get("assertion") ?? "");
  let verified = false;
  if (recovery) {
    verified = await consumeRecoveryCode(env, user.id, row, recovery);
  } else if (method === "totp" && code) {
    verified = await verifyTotp(await decryptSecret(row.totp_secret!, env.SESSION_SECRET), code);
  } else if (method === "passkey" && assertion) {
    verified = await verifyPasskeyAssertion(request, env, user.id, `pk-auth:${user.id}`, assertion);
  }
  if (!verified) return { twoFactor: { error: "ยืนยันตัวตนไม่สำเร็จ กรุณาลองอีกครั้ง" } };

  if (intent === "2fa_disable") {
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE users SET totp_secret = NULL, totp_enabled_at = NULL, totp_recovery = NULL, two_factor_method = NULL, updated_at = unixepoch() WHERE id = ?"
      ).bind(user.id),
      env.DB.prepare("DELETE FROM user_passkeys WHERE user_id = ?").bind(user.id),
    ]);
    await evictUserCache(env.SESSIONPORTAL, user.id);
    await forgetTrustedDevices(env, user.id);
    return { twoFactor: { message: "ปิด 2FA แล้ว" } };
  }

  if (intent === "2fa_regen") {
    const { codes, hashes } = await newRecoveryHashes();
    await env.DB.prepare(
      "UPDATE users SET totp_recovery = ?, updated_at = unixepoch() WHERE id = ?"
    )
      .bind(JSON.stringify(hashes), user.id)
      .run();
    await evictUserCache(env.SESSIONPORTAL, user.id);
    return { twoFactor: { recoveryCodes: codes, message: "สร้าง recovery codes ใหม่แล้ว" } };
  }

  return { twoFactor: { error: "คำขอไม่ถูกต้อง" } };
}
