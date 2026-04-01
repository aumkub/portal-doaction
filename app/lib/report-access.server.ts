interface ReportAccessPayload {
  reportId: string;
  email: string;
  exp: number;
}

function base64UrlEncode(input: string): string {
  return btoa(input).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(input: string): string {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return atob(padded);
}

async function hmacSign(input: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(input));
  const bytes = new Uint8Array(sig);
  let raw = "";
  for (const b of bytes) raw += String.fromCharCode(b);
  return base64UrlEncode(raw);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function createReportAccessToken(
  payload: ReportAccessPayload,
  secret: string
): Promise<string> {
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const sig = await hmacSign(encodedPayload, secret);
  return `${encodedPayload}.${sig}`;
}

export async function verifyReportAccessToken(
  token: string,
  secret: string
): Promise<ReportAccessPayload | null> {
  const [encodedPayload, providedSig] = token.split(".");
  if (!encodedPayload || !providedSig) return null;

  const expectedSig = await hmacSign(encodedPayload, secret);
  if (!timingSafeEqual(providedSig, expectedSig)) return null;

  try {
    const raw = base64UrlDecode(encodedPayload);
    const parsed = JSON.parse(raw) as Partial<ReportAccessPayload>;
    if (
      typeof parsed.reportId !== "string" ||
      typeof parsed.email !== "string" ||
      typeof parsed.exp !== "number"
    ) {
      return null;
    }
    if (parsed.exp < Math.floor(Date.now() / 1000)) return null;
    return {
      reportId: parsed.reportId,
      email: parsed.email.toLowerCase(),
      exp: parsed.exp,
    };
  } catch {
    return null;
  }
}
