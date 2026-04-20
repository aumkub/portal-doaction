const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_CC_EMAILS = 5;

export function parseClientCcEmails(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string");
  } catch {
    return [];
  }
}

export function normalizeClientCcEmailsInput(rawInput: string | null | undefined): {
  emails: string[];
  error?: string;
} {
  const raw = (rawInput ?? "").trim();
  if (!raw) return { emails: [] };

  const parts = raw
    .split(/[\n,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const unique = Array.from(new Set(parts));

  if (unique.length > MAX_CC_EMAILS) {
    return { emails: [], error: "สามารถเพิ่มอีเมล CC ได้สูงสุด 5 อีเมล" };
  }

  const invalid = unique.find((email) => !EMAIL_REGEX.test(email));
  if (invalid) {
    return { emails: [], error: `อีเมล CC ไม่ถูกต้อง: ${invalid}` };
  }

  return { emails: unique };
}

export function stringifyClientCcEmails(emails: string[]): string | null {
  return emails.length ? JSON.stringify(emails) : null;
}
