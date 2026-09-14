import type { EmailLanguage } from "~/lib/email.server";

const strings = {
  th: {
    replySubject: (title: string) => `มีข้อความใหม่ใน Ticket: ${title}`,
    replyHeadline: "มีข้อความใหม่จากทีมงาน",
    replyGreeting: (name: string) => `สวัสดีคุณ ${name}`,
    replyTicketLabel: "Ticket:",
    replyBtn: "เปิด Ticket",
    replyText: (name: string, title: string, msg: string, url: string) =>
      [`สวัสดีคุณ ${name}`, `มีข้อความใหม่ใน Ticket: ${title}`, "", msg, "", `เปิด Ticket: ${url}`].join("\n"),

    closedSubject: (title: string) => `Ticket ถูกปิดแล้ว: ${title}`,
    closedHeadline: "Ticket ปิดเรียบร้อยแล้ว",
    closedGreeting: (name: string) => `สวัสดีคุณ ${name}`,
    closedBody: "หากยังมีประเด็นเพิ่มเติม คุณสามารถตอบกลับใน Ticket เดิมได้ตลอดเวลา",
    closedBtn: "ดูรายละเอียด Ticket",
    closedText: (name: string, title: string, url: string) =>
      [`สวัสดีคุณ ${name}`, `Ticket ถูกปิดแล้ว: ${title}`, "", `ดูรายละเอียด: ${url}`].join("\n"),
  },
  en: {
    replySubject: (title: string) => `New message in Ticket: ${title}`,
    replyHeadline: "New message from the team",
    replyGreeting: (name: string) => `Hello ${name}`,
    replyTicketLabel: "Ticket:",
    replyBtn: "Open Ticket",
    replyText: (name: string, title: string, msg: string, url: string) =>
      [`Hello ${name}`, `New message in Ticket: ${title}`, "", msg, "", `Open Ticket: ${url}`].join("\n"),

    closedSubject: (title: string) => `Ticket closed: ${title}`,
    closedHeadline: "Ticket closed",
    closedGreeting: (name: string) => `Hello ${name}`,
    closedBody: "If you have any further questions, you can reply to the same ticket at any time.",
    closedBtn: "View Ticket",
    closedText: (name: string, title: string, url: string) =>
      [`Hello ${name}`, `Ticket closed: ${title}`, "", `View details: ${url}`].join("\n"),
  },
} as const;

export function buildTicketReplyEmail(opts: {
  contactName: string;
  ticketTitle: string;
  message: string;
  ticketUrl: string;
  lang?: EmailLanguage;
}): { subject: string; html: string; text: string } {
  const s = strings[opts.lang ?? "th"];
  const subject = s.replySubject(opts.ticketTitle);
  const safeMessage = escapeHtml(opts.message);
  const safeTitle = escapeHtml(opts.ticketTitle);
  const safeName = escapeHtml(opts.contactName);
  const safeUrl = escapeHtml(opts.ticketUrl);

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:12px;overflow:hidden;">
        <tr><td style="height:4px;background:#7c3aed;"></td></tr>
        <tr><td style="padding:24px;">
          <p style="margin:0 0 12px;font-size:18px;font-weight:700;color:#0f172a;">${s.replyHeadline}</p>
          <p style="margin:0 0 8px;font-size:14px;color:#475569;">${s.replyGreeting(safeName)}</p>
          <p style="margin:0 0 12px;font-size:14px;color:#475569;">${s.replyTicketLabel} <strong>${safeTitle}</strong></p>
          <div style="padding:12px;border-radius:8px;background:#f8fafc;border:1px solid #e2e8f0;font-size:14px;color:#334155;line-height:1.6;">
            ${safeMessage}
          </div>
          <p style="margin:16px 0 0;">
            <a href="${safeUrl}" style="display:inline-block;background:#0f172a;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-size:14px;font-weight:600;">${s.replyBtn}</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = s.replyText(opts.contactName, opts.ticketTitle, opts.message, opts.ticketUrl);

  return { subject, html, text };
}

export function buildTicketClosedEmail(opts: {
  contactName: string;
  ticketTitle: string;
  ticketUrl: string;
  lang?: EmailLanguage;
}): { subject: string; html: string; text: string } {
  const s = strings[opts.lang ?? "th"];
  const subject = s.closedSubject(opts.ticketTitle);
  const safeTitle = escapeHtml(opts.ticketTitle);
  const safeName = escapeHtml(opts.contactName);
  const safeUrl = escapeHtml(opts.ticketUrl);

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:12px;overflow:hidden;">
        <tr><td style="height:4px;background:#16a34a;"></td></tr>
        <tr><td style="padding:24px;">
          <p style="margin:0 0 12px;font-size:18px;font-weight:700;color:#0f172a;">${s.closedHeadline}</p>
          <p style="margin:0 0 8px;font-size:14px;color:#475569;">${s.closedGreeting(safeName)}</p>
          <p style="margin:0 0 12px;font-size:14px;color:#475569;">${escapeHtml("Ticket")}: <strong>${safeTitle}</strong></p>
          <p style="margin:0 0 16px;font-size:14px;color:#334155;">${s.closedBody}</p>
          <p style="margin:0;">
            <a href="${safeUrl}" style="display:inline-block;background:#0f172a;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-size:14px;font-weight:600;">${s.closedBtn}</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = s.closedText(opts.contactName, opts.ticketTitle, opts.ticketUrl);

  return { subject, html, text };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
