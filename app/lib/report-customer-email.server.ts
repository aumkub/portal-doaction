import { getThaiMonth, getMonthName } from "~/lib/utils";
import type { EmailLanguage } from "~/lib/email.server";

const strings = {
  th: {
    subject: (period: string, company: string) =>
      `รายงานประจำเดือน ${period} พร้อมแล้ว — ${company}`,
    label: "DoAction · Client Portal",
    headline: "รายงานประจำเดือนพร้อมแล้ว",
    greeting: (name: string, company: string) =>
      `สวัสดีคุณ <strong style="color:#0f172a;">${name}</strong><br /><strong style="color:#0f172a;">${company}</strong>`,
    body: (title: string, period: string) =>
      `รายงาน <strong style="color:#0f172a;">${title}</strong> สำหรับ <strong style="color:#0f172a;">${period}</strong> ได้เผยแพร่ใน Portal แล้ว`,
    cta: "เปิดรายงานใน Portal",
    fallback: "หากปุ่มไม่ทำงาน คัดลอกลิงก์นี้ไปวางในเบราว์เซอร์:",
    footer: "อีเมลนี้ส่งจาก do action portal แจ้งเตือนรายงานประจำเดือน<br />หากมีคำถาม ติดต่อทีม DoAction ได้ตามช่องทางที่คุณคุ้นเคย",
    textGreeting: (name: string, company: string) => `สวัสดีคุณ ${name} (${company})`,
    textBody: (title: string, period: string) =>
      `รายงาน "${title}" สำหรับ ${period} พร้อมแล้วใน do action portal`,
    period: (month: number, year: number) => `${getThaiMonth(month)} ${year + 543}`,
  },
  en: {
    subject: (period: string, company: string) =>
      `Monthly report for ${period} is ready — ${company}`,
    label: "DoAction · Client Portal",
    headline: "Your monthly report is ready",
    greeting: (name: string, company: string) =>
      `Hello <strong style="color:#0f172a;">${name}</strong><br /><strong style="color:#0f172a;">${company}</strong>`,
    body: (title: string, period: string) =>
      `The report <strong style="color:#0f172a;">${title}</strong> for <strong style="color:#0f172a;">${period}</strong> has been published to your Portal.`,
    cta: "Open Report in Portal",
    fallback: "If the button doesn't work, copy and paste this URL into your browser:",
    footer: "This email was sent from do action portal as a monthly report notification.<br />If you have questions, contact the DoAction team through your usual channels.",
    textGreeting: (name: string, company: string) => `Hello ${name} (${company})`,
    textBody: (title: string, period: string) =>
      `The report "${title}" for ${period} is ready in do action portal`,
    period: (month: number, year: number) => `${getMonthName(month, "en")} ${year}`,
  },
} as const;

export function buildReportCustomerNotification(opts: {
  companyName: string;
  contactName: string;
  reportTitle: string;
  year: number;
  month: number;
  summary: string | null;
  reportUrl: string;
  lang?: EmailLanguage;
}): { subject: string; html: string; text: string } {
  const s = strings[opts.lang ?? "th"];
  const period = s.period(opts.month, opts.year);
  const subject = s.subject(period, opts.companyName);

  const safeName = escapeHtml(opts.contactName);
  const safeCompany = escapeHtml(opts.companyName);
  const safeTitle = escapeHtml(opts.reportTitle);
  const safePeriod = escapeHtml(period);

  const summaryBlock = opts.summary
    ? `<p style="margin:16px 0 0;font-size:15px;line-height:1.6;color:#475569;">${escapeHtml(opts.summary)}</p>`
    : "";

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#f1f5f9;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(15,23,42,0.08);">
          <tr>
            <td style="height:4px;background:linear-gradient(90deg,#F0D800,#EAB308);"></td>
          </tr>
          <tr>
            <td style="padding:28px 28px 8px;">
              <p style="margin:0;font-size:12px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:#64748b;">${s.label}</p>
              <h1 style="margin:12px 0 0;font-size:22px;line-height:1.3;color:#0f172a;">${s.headline}</h1>
              <p style="margin:12px 0 0;font-size:15px;line-height:1.6;color:#475569;">
                ${s.greeting(safeName, safeCompany)}
              </p>
              <p style="margin:16px 0 0;font-size:15px;line-height:1.6;color:#475569;">
                ${s.body(safeTitle, safePeriod)}
              </p>
              ${summaryBlock}
            </td>
          </tr>
          <tr>
            <td style="padding:8px 28px 28px;">
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin-top:8px;">
                <tr>
                  <td style="border-radius:10px;background:#0f172a;">
                    <a href="${escapeAttr(opts.reportUrl)}" target="_blank" rel="noopener noreferrer"
                      style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">
                      ${s.cta}
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:20px 0 0;font-size:13px;line-height:1.5;color:#94a3b8;">
                ${s.fallback}<br />
                <span style="word-break:break-all;color:#64748b;">${escapeHtml(opts.reportUrl)}</span>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 28px 24px;border-top:1px solid #e2e8f0;background:#fafafa;">
              <p style="margin:0;font-size:12px;color:#94a3b8;line-height:1.5;">
                ${s.footer}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = [
    s.textGreeting(opts.contactName, opts.companyName),
    "",
    s.textBody(opts.reportTitle, period),
    opts.summary ? `\n${opts.summary}\n` : "",
    `${s.cta}: ${opts.reportUrl}`,
    "",
    "— DoAction",
  ]
    .filter(Boolean)
    .join("\n");

  return { subject, html, text };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/'/g, "&#39;");
}
