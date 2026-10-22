/**
 * Pure Web Crypto helpers for the site-care agent protocol.
 * No env/DB access here so the signing logic can be tested in isolation.
 *
 * Signature = hex HMAC-SHA256(secretHex, `${timestamp}\n${nonce}\n${sha256hex(body)}`)
 * where the HMAC key is the UTF-8 bytes of the 64-char hex secret
 * (matches PHP `hash_hmac('sha256', $msg, $secret_hex)`).
 */

const enc = new TextEncoder();

export function toHex(buf: ArrayBuffer | Uint8Array): string {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
}

export function randomHex(bytes: number): string {
  return toHex(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === "string" ? enc.encode(data) : data;
  return toHex(await crypto.subtle.digest("SHA-256", bytes));
}

export async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  return toHex(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
}

export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signPayload(secret: string, timestamp: string, nonce: string, body: string | Uint8Array): Promise<string> {
  return hmacHex(secret, `${timestamp}\n${nonce}\n${await sha256hex(body)}`);
}

export const MAX_SKEW_SECONDS = 300;

/** Pure check of timestamp window + signature. Nonce replay is checked by the caller (KV). */
export async function verifySignature(opts: {
  secret: string; timestamp: string; nonce: string; signature: string;
  body: string | Uint8Array; now?: number;
}): Promise<"ok" | "stale" | "bad_signature" | "malformed"> {
  const { secret, timestamp, nonce, signature, body } = opts;
  if (!/^\d{1,12}$/.test(timestamp) || !/^[A-Za-z0-9_-]{16,128}$/.test(nonce) || !/^[0-9a-f]{64}$/.test(signature)) {
    return "malformed";
  }
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > MAX_SKEW_SECONDS) return "stale";
  const expected = await signPayload(secret, timestamp, nonce, body);
  return timingSafeEqualHex(expected, signature) ? "ok" : "bad_signature";
}

// ── At-rest encryption of site secrets (AES-256-GCM, key = HKDF(SESSION_SECRET)) ──

async function deriveKey(masterSecret: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", enc.encode(masterSecret), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: enc.encode("doaction-site-care"), info: enc.encode("site-secret-v1") },
    base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
  );
}

function b64(bytes: Uint8Array): string {
  let s = "";
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s);
}
function unb64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

export async function encryptSecret(masterSecret: string, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await deriveKey(masterSecret), enc.encode(plaintext)));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv); out.set(ct, iv.length);
  return "v1:" + b64(out);
}

export async function decryptSecret(masterSecret: string, stored: string): Promise<string> {
  if (!stored.startsWith("v1:")) throw new Error("unknown secret format");
  const raw = unb64(stored.slice(3));
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: raw.slice(0, 12) }, await deriveKey(masterSecret), raw.slice(12));
  return new TextDecoder().decode(pt);
}

/** Human-friendly pairing code: 10 chars from an unambiguous alphabet (~50 bits). */
export function generatePairCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  let s = "";
  for (const b of bytes) s += alphabet[b % 32];
  return s;
}

export function normalizePairCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}
