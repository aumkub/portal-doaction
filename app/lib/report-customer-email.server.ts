import { getThaiMonth } from "~/lib/utils";

export function buildReportCustomerNotification(opts: {
  companyName: string;
  contactName: string;
  reportTitle: string;
  year: number;
  month: number;
  summary: string | null;
  reportUrl: string;
}): { subject: string; html: string; text: string } {
  const periodTh = `${getThaiMonth(opts.month)} ${opts.year + 543}`;
  const subject = `รายงานประจำเดือน ${periodTh} พร้อมแล้ว — ${opts.companyName}`;

  const summaryBlock = opts.summary
    ? `<p style="margin:16px 0 0;font-size:15px;line-height:1.6;color:#475569;">${escapeHtml(opts.summary)}</p>`
    : "";

  const html = `<!DOCTYPE html>
<html lang="th">
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
              <p style="margin:0;font-size:12px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:#64748b;">DoAction · Client Portal</p>
              <h1 style="margin:12px 0 0;font-size:22px;line-height:1.3;color:#0f172a;">รายงานประจำเดือนพร้อมแล้ว</h1>
              <p style="margin:12px 0 0;font-size:15px;line-height:1.6;color:#475569;">
                สวัสดีคุณ <strong style="color:#0f172a;">${escapeHtml(opts.contactName)}</strong><br />
                <strong style="color:#0f172a;">${escapeHtml(opts.companyName)}</strong>
              </p>
              <p style="margin:16px 0 0;font-size:15px;line-height:1.6;color:#475569;">
                รายงาน <strong style="color:#0f172a;">${escapeHtml(opts.reportTitle)}</strong>
                สำหรับ <strong style="color:#0f172a;">${escapeHtml(periodTh)}</strong> ได้เผยแพร่ใน Portal แล้ว
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
                      เปิดรายงานใน Portal
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:20px 0 0;font-size:13px;line-height:1.5;color:#94a3b8;">
                หากปุ่มไม่ทำงาน คัดลอกลิงก์นี้ไปวางในเบราว์เซอร์:<br />
                <span style="word-break:break-all;color:#64748b;">${escapeHtml(opts.reportUrl)}</span>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 28px 24px;border-top:1px solid #e2e8f0;background:#fafafa;">
              <p style="margin:0;font-size:12px;color:#94a3b8;line-height:1.5;">
                อีเมลนี้ส่งจาก do action portal แจ้งเตือนรายงานประจำเดือน<br />
                หากมีคำถาม ติดต่อทีม DoAction ได้ตามช่องทางที่คุณคุ้นเคย
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
    `สวัสดีคุณ ${opts.contactName} (${opts.companyName})`,
    "",
    `รายงาน "${opts.reportTitle}" สำหรับ ${periodTh} พร้อมแล้วใน do action portal`,
    opts.summary ? `\n${opts.summary}\n` : "",
    `เปิดรายงาน: ${opts.reportUrl}`,
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
