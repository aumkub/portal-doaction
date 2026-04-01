export function buildTicketReplyEmail(opts: {
  contactName: string;
  ticketTitle: string;
  message: string;
  ticketUrl: string;
}): { subject: string; html: string; text: string } {
  const subject = `มีข้อความใหม่ใน Ticket: ${opts.ticketTitle}`;
  const safeMessage = escapeHtml(opts.message);
  const safeTitle = escapeHtml(opts.ticketTitle);
  const safeName = escapeHtml(opts.contactName);
  const safeUrl = escapeHtml(opts.ticketUrl);

  const html = `<!DOCTYPE html>
<html lang="th">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:12px;overflow:hidden;">
        <tr><td style="height:4px;background:#7c3aed;"></td></tr>
        <tr><td style="padding:24px;">
          <p style="margin:0 0 12px;font-size:18px;font-weight:700;color:#0f172a;">มีข้อความใหม่จากทีมงาน</p>
          <p style="margin:0 0 8px;font-size:14px;color:#475569;">สวัสดีคุณ ${safeName}</p>
          <p style="margin:0 0 12px;font-size:14px;color:#475569;">Ticket: <strong>${safeTitle}</strong></p>
          <div style="padding:12px;border-radius:8px;background:#f8fafc;border:1px solid #e2e8f0;font-size:14px;color:#334155;line-height:1.6;">
            ${safeMessage}
          </div>
          <p style="margin:16px 0 0;">
            <a href="${safeUrl}" style="display:inline-block;background:#0f172a;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-size:14px;font-weight:600;">เปิด Ticket</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = [
    `สวัสดีคุณ ${opts.contactName}`,
    `มีข้อความใหม่ใน Ticket: ${opts.ticketTitle}`,
    "",
    opts.message,
    "",
    `เปิด Ticket: ${opts.ticketUrl}`,
  ].join("\n");

  return { subject, html, text };
}

export function buildTicketClosedEmail(opts: {
  contactName: string;
  ticketTitle: string;
  ticketUrl: string;
}): { subject: string; html: string; text: string } {
  const subject = `Ticket ถูกปิดแล้ว: ${opts.ticketTitle}`;
  const safeTitle = escapeHtml(opts.ticketTitle);
  const safeName = escapeHtml(opts.contactName);
  const safeUrl = escapeHtml(opts.ticketUrl);

  const html = `<!DOCTYPE html>
<html lang="th">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:12px;overflow:hidden;">
        <tr><td style="height:4px;background:#16a34a;"></td></tr>
        <tr><td style="padding:24px;">
          <p style="margin:0 0 12px;font-size:18px;font-weight:700;color:#0f172a;">Ticket ปิดเรียบร้อยแล้ว</p>
          <p style="margin:0 0 8px;font-size:14px;color:#475569;">สวัสดีคุณ ${safeName}</p>
          <p style="margin:0 0 12px;font-size:14px;color:#475569;">Ticket: <strong>${safeTitle}</strong></p>
          <p style="margin:0 0 16px;font-size:14px;color:#334155;">หากยังมีประเด็นเพิ่มเติม คุณสามารถตอบกลับใน Ticket เดิมได้ตลอดเวลา</p>
          <p style="margin:0;">
            <a href="${safeUrl}" style="display:inline-block;background:#0f172a;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-size:14px;font-weight:600;">ดูรายละเอียด Ticket</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = [
    `สวัสดีคุณ ${opts.contactName}`,
    `Ticket ถูกปิดแล้ว: ${opts.ticketTitle}`,
    "",
    `ดูรายละเอียด: ${opts.ticketUrl}`,
  ].join("\n");

  return { subject, html, text };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
