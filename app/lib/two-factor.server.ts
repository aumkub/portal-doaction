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
import type { User } from "~/types";

const CHALLENGE_TTL = 300;
const SETUP_TTL = 600;
const MAX_ATTEMPTS = 5;
export const TWO_FACTOR_COOKIE = "doaction_2fa";

interface TotpRow {
  totp_secret: string | null;
  totp_enabled_at: number | null;
  totp_recovery: string | null;
}

interface Challenge {
  userId: string;
  redirect: string;
  attempts: number;
}

export function safeRedirect(dest: string | null | undefined, fallback: string): string {
  if (!dest || !dest.startsWith("/") || dest.startsWith("//") || dest.startsWith("/\\")) {
    return fallback;
  }
  return dest;
}

export async function getTotpRow(d1: D1Database, userId: string): Promise<TotpRow | null> {
  return d1
    .prepare("SELECT totp_secret, totp_enabled_at, totp_recovery FROM users WHERE id = ?")
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
  if (row?.totp_enabled_at && row.totp_secret) {
    const token = generateId(32);
    await env.SESSIONPORTAL.put(
      `2fa:${token}`,
      JSON.stringify({ userId: user.id, redirect: redirectTo, attempts: 0 } satisfies Challenge),
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

/** Verifies a TOTP or recovery code against the user's stored factors. */
async function checkSecondFactor(
  env: CloudflareEnv,
  userId: string,
  code: string,
  useRecovery: boolean
): Promise<boolean> {
  const row = await getTotpRow(env.DB, userId);
  if (!row?.totp_enabled_at || !row.totp_secret) return false;
  if (!useRecovery) {
    const secret = await decryptSecret(row.totp_secret, env.SESSION_SECRET);
    return verifyTotp(secret, code);
  }
  const hashes: string[] = row.totp_recovery ? JSON.parse(row.totp_recovery) : [];
  const hash = await hashRecoveryCode(code);
  if (!hashes.includes(hash)) return false;
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

export async function verifyChallenge(opts: {
  request: Request;
  env: CloudflareEnv;
  code: string;
  useRecovery: boolean;
}): Promise<Response | { error: string }> {
  const { request, env, code, useRecovery } = opts;
  const challenge = await getChallenge(env, request);
  if (!challenge) {
    return redirect("/login?error=2fa_expired", {
      headers: { "Set-Cookie": clearCookieHeader(request) },
    });
  }
  const { token, data } = challenge;
  const ok = await checkSecondFactor(env, data.userId, code, useRecovery);
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
    return { error: "รหัสไม่ถูกต้อง กรุณาลองอีกครั้ง" };
  }
  await env.SESSIONPORTAL.delete(`2fa:${token}`);
  const { lucia } = createAuth(env.DB, env.SESSIONPORTAL);
  const session = await lucia.createSession(data.userId, {});
  const headers = new Headers();
  headers.append("Set-Cookie", lucia.createSessionCookie(session.id).serialize());
  headers.append("Set-Cookie", clearCookieHeader(request));
  return redirect(safeRedirect(data.redirect, "/admin"), { headers });
}

// ─── Enrollment / management (settings page) ────────────────────────────────

export interface TwoFactorState {
  enabled: boolean;
  enabledAt: number | null;
  recoveryRemaining: number;
  setup: { secret: string; qrSvg: string } | null;
}

export async function loadTwoFactorState(
  env: CloudflareEnv,
  user: Pick<User, "id" | "email">
): Promise<TwoFactorState> {
  const row = await getTotpRow(env.DB, user.id);
  const enabled = Boolean(row?.totp_enabled_at && row.totp_secret);
  let setup: TwoFactorState["setup"] = null;
  if (!enabled) {
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
  return {
    enabled,
    enabledAt: row?.totp_enabled_at ?? null,
    recoveryRemaining: enabled ? recovery.length : 0,
    setup,
  };
}

export type TwoFactorActionResult =
  | { twoFactor: { error?: string; recoveryCodes?: string[]; message?: string } }
  | null;

async function newRecoveryHashes() {
  const codes = generateRecoveryCodes();
  const hashes = await Promise.all(codes.map(hashRecoveryCode));
  return { codes, hashes };
}

/** Handles `2fa_*` intents; returns null for any other intent. */
export async function handleTwoFactorIntent(
  env: CloudflareEnv,
  user: Pick<User, "id" | "email">,
  intent: string,
  formData: FormData
): Promise<TwoFactorActionResult> {
  if (!intent.startsWith("2fa_")) return null;
  const code = String(formData.get("code") ?? "").trim();
  const invalid = { twoFactor: { error: "รหัสไม่ถูกต้อง กรุณาลองอีกครั้ง" } };
  const setupKey = `2fa-setup:${user.id}`;

  if (intent === "2fa_start") {
    const encrypted = await encryptSecret(generateTotpSecret(), env.SESSION_SECRET);
    await env.SESSIONPORTAL.put(setupKey, encrypted, { expirationTtl: SETUP_TTL });
    return { twoFactor: {} };
  }

  if (intent === "2fa_cancel") {
    await env.SESSIONPORTAL.delete(setupKey);
    return { twoFactor: {} };
  }

  if (intent === "2fa_confirm") {
    const pending = await env.SESSIONPORTAL.get(setupKey);
    if (!pending) return { twoFactor: { error: "หมดเวลาตั้งค่า กรุณาเริ่มใหม่" } };
    const secret = await decryptSecret(pending, env.SESSION_SECRET);
    if (!(await verifyTotp(secret, code))) return invalid;
    const { codes, hashes } = await newRecoveryHashes();
    await env.DB.prepare(
      "UPDATE users SET totp_secret = ?, totp_enabled_at = unixepoch(), totp_recovery = ?, updated_at = unixepoch() WHERE id = ?"
    )
      .bind(pending, JSON.stringify(hashes), user.id)
      .run();
    await env.SESSIONPORTAL.delete(setupKey);
    await evictUserCache(env.SESSIONPORTAL, user.id);
    return { twoFactor: { recoveryCodes: codes, message: "เปิดใช้ 2FA แล้ว" } };
  }

  const row = await getTotpRow(env.DB, user.id);
  if (!row?.totp_enabled_at || !row.totp_secret) return { twoFactor: { error: "ยังไม่ได้เปิดใช้ 2FA" } };
  const secret = await decryptSecret(row.totp_secret, env.SESSION_SECRET);
  if (!(await verifyTotp(secret, code))) return invalid;

  if (intent === "2fa_disable") {
    await env.DB.prepare(
      "UPDATE users SET totp_secret = NULL, totp_enabled_at = NULL, totp_recovery = NULL, updated_at = unixepoch() WHERE id = ?"
    )
      .bind(user.id)
      .run();
    await evictUserCache(env.SESSIONPORTAL, user.id);
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
