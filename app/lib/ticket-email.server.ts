import { sendEmail } from "~/lib/email.server";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getLogoUrlFromTicketUrl(ticketUrl: string): string | null {
  try {
    const origin = new URL(ticketUrl).origin;
    return `${origin}/logo-dark.svg`;
  } catch {
    return null;
  }
}

function logoHeaderHtml(ticketUrl: string): string {
  const logoUrl = getLogoUrlFromTicketUrl(ticketUrl);
  if (!logoUrl) return "";
  return `<p style="margin:0 0 14px;">
    <img src="${logoUrl}" alt="DoAction" width="140" style="display:block;height:auto;border:0;outline:none;text-decoration:none;" />
  </p>`;
}

export async function sendTicketEmailToClient(params: {
  to: string;
  toName?: string;
  ticketTitle: string;
  message: string;
  ticketUrl: string;
  apiKey: string;
}) {
  const { to, toName, ticketTitle, message, ticketUrl, apiKey } = params;
  const subject = `มีข้อความใหม่ใน Ticket: ${ticketTitle}`;
  const text = [
    `สวัสดีคุณ ${toName ?? to}`,
    "",
    `มีข้อความใหม่ใน Ticket: ${ticketTitle}`,
    "",
    message,
    "",
    `เปิด Ticket: ${ticketUrl}`,
    "",
    "— DoAction",
  ].join("\n");
  const html = `<!doctype html><html lang="th"><body style="font-family:system-ui,sans-serif;color:#0f172a;">
    ${logoHeaderHtml(ticketUrl)}
    <p>สวัสดีคุณ ${escapeHtml(toName ?? to)}</p>
    <p>มีข้อความใหม่ใน Ticket: <strong>${escapeHtml(ticketTitle)}</strong></p>
    <blockquote style="margin:12px 0;padding:12px;border-left:3px solid #cbd5e1;background:#f8fafc;">${escapeHtml(message)}</blockquote>
    <p><a href="${ticketUrl}">เปิด Ticket ในระบบ</a></p>
    <p style="color:#64748b;">— DoAction</p>
  </body></html>`;
  await sendEmail({ to, toName, subject, html, text, apiKey });
}

export async function sendTicketEmailToAdmin(params: {
  to: string;
  toName?: string;
  clientName: string;
  ticketTitle: string;
  message: string;
  ticketUrl: string;
  apiKey: string;
}) {
  const { to, toName, clientName, ticketTitle, message, ticketUrl, apiKey } = params;
  const subject = `ลูกค้าตอบ Ticket: ${ticketTitle}`;
  const text = [
    `สวัสดีคุณ ${toName ?? to}`,
    "",
    `ลูกค้า ${clientName} ตอบกลับ Ticket: ${ticketTitle}`,
    "",
    message,
    "",
    `เปิด Ticket: ${ticketUrl}`,
    "",
    "— DoAction",
  ].join("\n");
  const html = `<!doctype html><html lang="th"><body style="font-family:system-ui,sans-serif;color:#0f172a;">
    ${logoHeaderHtml(ticketUrl)}
    <p>สวัสดีคุณ ${escapeHtml(toName ?? to)}</p>
    <p>ลูกค้า <strong>${escapeHtml(clientName)}</strong> ตอบกลับ Ticket: <strong>${escapeHtml(ticketTitle)}</strong></p>
    <blockquote style="margin:12px 0;padding:12px;border-left:3px solid #cbd5e1;background:#f8fafc;">${escapeHtml(message)}</blockquote>
    <p><a href="${ticketUrl}">เปิด Ticket ในระบบ</a></p>
    <p style="color:#64748b;">— DoAction</p>
  </body></html>`;
  await sendEmail({ to, toName, subject, html, text, apiKey });
}

export async function sendTicketClosedEmailToClient(params: {
  to: string;
  toName?: string;
  ticketTitle: string;
  ticketUrl: string;
  apiKey: string;
}) {
  const { to, toName, ticketTitle, ticketUrl, apiKey } = params;
  const subject = `Ticket ถูกปิดแล้ว: ${ticketTitle}`;
  const text = [
    `สวัสดีคุณ ${toName ?? to}`,
    "",
    `Ticket "${ticketTitle}" ถูกปิดเรียบร้อยแล้ว`,
    "หากยังมีประเด็นเพิ่มเติม สามารถตอบกลับใน Ticket เดิมได้",
    "",
    `ดูรายละเอียด: ${ticketUrl}`,
    "",
    "— DoAction",
  ].join("\n");
  const html = `<!doctype html><html lang="th"><body style="font-family:system-ui,sans-serif;color:#0f172a;">
    ${logoHeaderHtml(ticketUrl)}
    <p>สวัสดีคุณ ${escapeHtml(toName ?? to)}</p>
    <p>Ticket <strong>${escapeHtml(ticketTitle)}</strong> ถูกปิดเรียบร้อยแล้ว</p>
    <p>หากยังมีประเด็นเพิ่มเติม สามารถตอบกลับใน Ticket เดิมได้</p>
    <p><a href="${ticketUrl}">ดูรายละเอียด Ticket</a></p>
    <p style="color:#64748b;">— DoAction</p>
  </body></html>`;
  await sendEmail({ to, toName, subject, html, text, apiKey });
}
