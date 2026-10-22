/**
 * RFC 6238 TOTP (SHA-1, 30s step) plus the secret encryption and recovery
 * code helpers 2FA needs. Web Crypto only — runs on Workers and in Node.
 */

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_SECONDS = 30;
export const TOTP_ISSUER = "do action portal";

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Uint8Array {
  const clean = input.toUpperCase().replace(/[\s=-]/g, "");
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of clean) {
    const idx = BASE32.indexOf(ch);
    if (idx === -1) throw new Error("Invalid base32");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

/** 160-bit random secret, base32 encoded (32 chars). */
export function generateTotpSecret(): string {
  return base32Encode(crypto.getRandomValues(new Uint8Array(20)));
}

export async function hotp(key: Uint8Array, counter: number, digits = 6): Promise<string> {
  const msg = new Uint8Array(8);
  let c = counter;
  for (let i = 7; i >= 0; i--) {
    msg[i] = c & 0xff;
    c = Math.floor(c / 256);
  }
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, msg));
  const offset = mac[mac.length - 1] & 0x0f;
  const bin =
    ((mac[offset] & 0x7f) << 24) |
    (mac[offset + 1] << 16) |
    (mac[offset + 2] << 8) |
    mac[offset + 3];
  return String(bin % 10 ** digits).padStart(digits, "0");
}

export function totpAt(key: Uint8Array, unixSeconds: number, digits = 6) {
  return hotp(key, Math.floor(unixSeconds / STEP_SECONDS), digits);
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Accepts the current step and ±1 step of clock drift. */
export async function verifyTotp(
  secretBase32: string,
  code: string,
  now = Math.floor(Date.now() / 1000)
): Promise<boolean> {
  const clean = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(clean)) return false;
  const key = base32Decode(secretBase32);
  let ok = false;
  for (const delta of [-1, 0, 1]) {
    const expected = await totpAt(key, now + delta * STEP_SECONDS);
    if (safeEqual(expected, clean)) ok = true;
  }
  return ok;
}

export function buildOtpauthUri(secret: string, email: string): string {
  const label = encodeURIComponent(`${TOTP_ISSUER}:${email}`);
  const params = new URLSearchParams({
    secret,
    issuer: TOTP_ISSUER,
    algorithm: "SHA1",
    digits: "6",
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString().replace(/\+/g, "%20")}`;
}

// ─── Secret encryption (AES-GCM, key derived from SESSION_SECRET) ────────────

async function deriveKey(sessionSecret: string): Promise<CryptoKey> {
  if (!sessionSecret) throw new Error("SESSION_SECRET is not configured");
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(sessionSecret),
    "HKDF",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new TextEncoder().encode("doaction-portal-totp"),
      info: new TextEncoder().encode("totp-secret-v1"),
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

function toB64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

/** Returns `v1:<iv b64>:<ciphertext b64>`. */
export async function encryptSecret(plain: string, sessionSecret: string): Promise<string> {
  const key = await deriveKey(sessionSecret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain))
  );
  return `v1:${toB64(iv)}:${toB64(ct)}`;
}

export async function decryptSecret(stored: string, sessionSecret: string): Promise<string> {
  const [version, ivB64, ctB64] = stored.split(":");
  if (version !== "v1" || !ivB64 || !ctB64) throw new Error("Unknown secret format");
  const key = await deriveKey(sessionSecret);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64(ivB64) },
    key,
    fromB64(ctB64)
  );
  return new TextDecoder().decode(plain);
}

// ─── Recovery codes ───────────────────────────────────────────────────────────

const RECOVERY_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

function randomChars(n: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  let out = "";
  // 248 = largest multiple of 31 below 256 → no modulo bias
  for (const b of bytes) {
    if (b >= 248) return randomChars(n);
    out += RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length];
  }
  return out;
}

/** 10 codes formatted `xxxx-xxxx`. */
export function generateRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => `${randomChars(4)}-${randomChars(4)}`);
}

export function normalizeRecoveryCode(code: string): string {
  const c = code.toLowerCase().replace(/[^a-z0-9]/g, "");
  return c.length === 8 ? `${c.slice(0, 4)}-${c.slice(4)}` : c;
}

export async function hashRecoveryCode(code: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(normalizeRecoveryCode(code))
  );
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
