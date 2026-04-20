// ─── Cloudflare Email Routing email sender ─────────────────────────────────────
// Docs: https://developers.cloudflare.com/email-routing/email-workers/send-email-workers/

import { generateId } from "~/lib/utils";
import type { DB } from "~/lib/db.server";
import { EmailMessage } from "cloudflare:email";

export type EmailLanguage = "th" | "en";
const MAIL_FROM = "aum@doaction.co.th";

interface SendEmailOptions {
  to: string;
  toName?: string;
  cc?: Array<{ email: string; name?: string }>;
  subject: string;
  html: string;
  text: string;
  sendEmail: SendEmail; // Cloudflare Email binding
  db?: DB;
  source?: string;
}

export async function sendEmail({
  to,
  toName,
  cc,
  subject,
  html,
  text,
  sendEmail,
  db,
  source,
}: SendEmailOptions): Promise<void> {
  // Validate sendEmail binding exists
  if (!sendEmail) {
    throw new Error("sendEmail binding is not configured");
  }

  const mainRecipient = to.trim().toLowerCase();
  const normalizedCc = (cc ?? [])
    .map((recipient) => ({
      email: recipient.email.trim().toLowerCase(),
      name: recipient.name,
    }))
    .filter((recipient) => recipient.email && recipient.email !== mainRecipient);
  const uniqueCc = Array.from(new Map(normalizedCc.map((r) => [r.email, r])).values());
  const ccRecipients = uniqueCc.map((c) => (c.name ? `${c.name} <${c.email}>` : c.email));

  // Build MIME message
  const boundary = "boundary_" + generateId();
  const emailBody = buildMimeMessage({
    to,
    toName,
    cc: ccRecipients,
    subject,
    html,
    text,
    boundary,
  });

  const message = new EmailMessage(
    MAIL_FROM,
    to.trim(),
    emailBody,
  );

  try {
    await sendEmail.send(message);

    if (db) {
      await db.createEmailLog({
        id: generateId(),
        to_email: to,
        to_name: toName ?? null,
        cc_emails: ccRecipients.length > 0 ? JSON.stringify(uniqueCc.map(c => c.email)) : null,
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
        cc_emails: ccRecipients.length > 0 ? JSON.stringify(uniqueCc.map(c => c.email)) : null,
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

function buildMimeMessage({
  to,
  toName,
  cc,
  subject,
  html,
  text,
  boundary,
}: {
  to: string;
  toName?: string;
  cc: string[];
  subject: string;
  html: string;
  text: string;
  boundary: string;
}): string {
  const toAddr = toName ? `${toName} <${to}>` : to;
  const messageId = `<${generateId()}@doaction.co.th>`;
  const headers = [
    `From: ${MAIL_FROM}`,
    `To: ${toAddr}`,
    ...(cc.length > 0 ? [`Cc: ${cc.join(", ")}`] : []),
    `Subject: ${subject}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${messageId}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];

  return [
    ...headers,
    ``,
    `--${boundary}`,
    `Content-Type: text/plain; charset=UTF-8`,
    `Content-Transfer-Encoding: 7bit`,
    ``,
    text,
    ``,
    `--${boundary}`,
    `Content-Type: text/html; charset=UTF-8`,
    `Content-Transfer-Encoding: 7bit`,
    ``,
    html,
    ``,
    `--${boundary}--`,
  ].join("\r\n");
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
      `สวัสดีคุณ ${name}\\n\\nคลิกลิ้งก์ด้านล่างเพื่อเข้าสู่ระบบ (หมดอายุใน 15 นาที)\\n\\n${url}\\n\\nหากคุณไม่ได้ขอลิ้งก์นี้ กรุณาเพิกเฉย\\n\\n— ทีม do action`,
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
      `Hello ${name}\\n\\nClick the link below to sign in (expires in 15 minutes)\\n\\n${url}\\n\\nIf you didn't request this, please ignore it.\\n\\n— do action Team`,
  },
} as const;

export async function sendMagicLinkEmail({
  to,
  toName,
  magicUrl,
  sendEmail: emailBinding,
  db,
  source,
  lang = "th",
}: {
  to: string;
  toName?: string;
  magicUrl: string;
  sendEmail: SendEmail;
  db?: DB;
  source?: string;
  lang?: EmailLanguage;
}): Promise<void> {
  // Validate sendEmail binding exists
  if (!emailBinding) {
    throw new Error("sendEmail binding is required for sending magic link emails");
  }

  const displayName = toName ?? to;
  const s = magicLinkStrings[lang];

  const mainRecipient = to.trim().toLowerCase();
  const boundary = "boundary_" + generateId();
  const emailBody = buildMimeMessage({
    to,
    toName,
    cc: [],
    subject: s.subject,
    html: magicLinkHtml({ displayName, magicUrl, s }),
    text: s.textBody(displayName, magicUrl),
    boundary,
  });

  const message = new EmailMessage(
    MAIL_FROM,
    to.trim(),
    emailBody,
  );

  try {
    await emailBinding.send(message);

    if (db) {
      await db.createEmailLog({
        id: generateId(),
        to_email: to,
        to_name: toName ?? null,
        cc_emails: null,
        subject: s.subject,
        html_body: magicLinkHtml({ displayName, magicUrl, s }),
        text_body: s.textBody(displayName, magicUrl),
        source: source ?? "magic_link",
        status: "sent",
      });
    }
  } catch (error) {
    if (db) {
      await db.createEmailLog({
        id: generateId(),
        to_email: to,
        to_name: toName ?? null,
        cc_emails: null,
        subject: s.subject,
        html_body: magicLinkHtml({ displayName, magicUrl, s }),
        text_body: s.textBody(displayName, magicUrl),
        source: source ?? "magic_link",
        status: "failed",
        error_message: error instanceof Error ? error.message : String(error),
      });
    }
    throw error;
  }
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
