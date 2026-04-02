// ─── SMTP2GO REST API email sender ───────────────────────────────────────────
// Docs: https://apidoc.smtp2go.com/documentation/#/POST%20/email/send

import { generateId } from "~/lib/utils";
import type { DB } from "~/lib/db.server";

export type EmailLanguage = "th" | "en";

interface SendEmailOptions {
  to: string;
  toName?: string;
  subject: string;
  html: string;
  text: string;
  apiKey: string;
  db?: DB;
  source?: string;
}

export async function sendEmail({
  to,
  toName,
  subject,
  html,
  text,
  apiKey,
  db,
  source,
}: SendEmailOptions): Promise<void> {
  try {
    const res = await fetch("https://api.smtp2go.com/v3/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        to: [toName ? `${toName} <${to}>` : to],
        sender: "do action portal <aum@doaction.co.th>",
        subject,
        html_body: html,
        text_body: text,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`SMTP2GO error ${res.status}: ${body}`);
    }

    const data = (await res.json()) as { data?: { succeeded: number } };
    if (!data.data?.succeeded) {
      throw new Error("SMTP2GO: email was not delivered");
    }

    if (db) {
      await db.createEmailLog({
        id: generateId(),
        to_email: to,
        to_name: toName ?? null,
        subject,
        html_body: html,
        text_body: text,
        source: source ?? "unknown",
        status: "sent",
      });
    }
  } catch (error) {
    if (db) {
      await db.createEmailLog({
        id: generateId(),
        to_email: to,
        to_name: toName ?? null,
        subject,
        html_body: html,
        text_body: text,
        source: source ?? "unknown",
        status: "failed",
        error_message: error instanceof Error ? error.message : String(error),
      });
    }
    throw error;
  }
}

// ─── Magic Link Template ──────────────────────────────────────────────────────

const magicLinkStrings = {
  th: {
    subject: "ลิ้งก์เข้าสู่ระบบ do action portal",
    title: "เข้าสู่ระบบ do action portal",
    greeting: (name: string) => `สวัสดีคุณ ${name}`,
    body: "ทีม do action ได้รับคำขอเข้าสู่ระบบจากอีเมลของคุณ<br>คลิกปุ่มด้านล่างเพื่อเข้าสู่ระบบ Client Portal",
    cta: "เข้าสู่ระบบ &rarr;",
    fallback: "หากปุ่มด้านบนไม่ทำงาน ให้คัดลอก URL นี้ไปวางในเบราว์เซอร์:",
    expiry: "ลิ้งก์นี้จะหมดอายุใน <strong style=\"color:#64748b;\">15 นาที</strong>",
    ignore: "หากคุณไม่ได้ขอลิ้งก์นี้ กรุณาเพิกเฉยต่ออีเมลฉบับนี้",
    textBody: (name: string, url: string) =>
      `สวัสดีคุณ ${name}\n\nคลิกลิ้งก์ด้านล่างเพื่อเข้าสู่ระบบ (หมดอายุใน 15 นาที)\n\n${url}\n\nหากคุณไม่ได้ขอลิ้งก์นี้ กรุณาเพิกเฉย\n\n— ทีม do action`,
  },
  en: {
    subject: "Your login link for do action portal",
    title: "Sign in to do action portal",
    greeting: (name: string) => `Hello ${name}`,
    body: "do action received a sign-in request for your email address.<br>Click the button below to access your Client Portal.",
    cta: "Sign in &rarr;",
    fallback: "If the button above doesn't work, copy and paste this URL into your browser:",
    expiry: "This link expires in <strong style=\"color:#64748b;\">15 minutes</strong>",
    ignore: "If you didn't request this link, you can safely ignore this email.",
    textBody: (name: string, url: string) =>
      `Hello ${name}\n\nClick the link below to sign in (expires in 15 minutes)\n\n${url}\n\nIf you didn't request this, please ignore it.\n\n— do action Team`,
  },
} as const;

export async function sendMagicLinkEmail({
  to,
  toName,
  magicUrl,
  apiKey,
  db,
  source,
  lang = "th",
}: {
  to: string;
  toName?: string;
  magicUrl: string;
  apiKey: string;
  db?: DB;
  source?: string;
  lang?: EmailLanguage;
}): Promise<void> {
  const displayName = toName ?? to;
  const s = magicLinkStrings[lang];

  await sendEmail({
    to,
    toName,
    subject: s.subject,
    apiKey,
    db,
    source: source ?? "magic_link",
    text: s.textBody(displayName, magicUrl),
    html: magicLinkHtml({ displayName, magicUrl, s }),
  });
}

function magicLinkHtml({
  displayName,
  magicUrl,
  s,
}: {
  displayName: string;
  magicUrl: string;
  s: (typeof magicLinkStrings)["th"] | (typeof magicLinkStrings)["en"];
}): string {
  return /* html */ `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${s.title}</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:'Inter',ui-sans-serif,system-ui,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.08);">

          <!-- Header gradient bar -->
          <tr>
            <td style="background:linear-gradient(135deg,#1e293b 0%,#4c1d95 100%);height:6px;"></td>
          </tr>

          <!-- Logo row -->
          <tr>
            <td style="padding:32px 40px 0;">
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background:#f0d800;border-radius:8px;width:32px;height:32px;text-align:center;vertical-align:middle;">
                    <span style="font-weight:700;font-size:14px;color:#0f172a;">D</span>
                  </td>
                  <td style="padding-left:10px;vertical-align:middle;">
                    <span style="font-size:20px;font-weight:700;color:#0f172a;letter-spacing:-0.3px;">do action</span>
                    <span style="font-size:13px;color:#64748b;margin-left:6px;">Client Portal</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px 40px;">
              <p style="margin:0 0 8px;font-size:22px;font-weight:600;color:#0f172a;">
                ${s.greeting(displayName)}
              </p>
              <p style="margin:0 0 28px;font-size:14px;color:#475569;line-height:1.7;">
                ${s.body}
              </p>

              <!-- CTA Button -->
              <table cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
                <tr>
                  <td style="border-radius:8px;background:#7c3aed;">
                    <a href="${magicUrl}"
                       style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;letter-spacing:0.1px;">
                      ${s.cta}
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Fallback URL -->
              <p style="margin:0 0 4px;font-size:12px;color:#94a3b8;">
                ${s.fallback}
              </p>
              <p style="margin:0;font-size:12px;word-break:break-all;">
                <a href="${magicUrl}" style="color:#7c3aed;">${magicUrl}</a>
              </p>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding:0 40px;">
              <hr style="border:none;border-top:1px solid #e2e8f0;margin:0;" />
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:24px 40px 32px;">
              <p style="margin:0 0 4px;font-size:12px;color:#94a3b8;">
                ⏱ ${s.expiry}
              </p>
              <p style="margin:0;font-size:12px;color:#94a3b8;">
                ${s.ignore}
              </p>
              <p style="margin:16px 0 0;font-size:12px;color:#cbd5e1;">
                do action Co., Ltd. &nbsp;|&nbsp; aum@doaction.co.th
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
