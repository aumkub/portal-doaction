import { sendEmail } from "~/lib/email.server";
import type { EmailLanguage } from "~/lib/email.server";
import type { DB } from "~/lib/db.server";

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

const clientStrings = {
  th: {
    subject: (title: string) => `มีข้อความใหม่ใน Ticket: ${title}`,
    greeting: (name: string) => `สวัสดีคุณ ${name}`,
    newMsg: (title: string) => `มีข้อความใหม่ใน Ticket: ${title}`,
    openBtn: "เปิด Ticket ในระบบ",
    closedSubject: (title: string) => `Ticket ถูกปิดแล้ว: ${title}`,
    closedMsg: (title: string) => `Ticket <strong>${escapeHtml(title)}</strong> ถูกปิดเรียบร้อยแล้ว`,
    closedNote: "หากยังมีประเด็นเพิ่มเติม สามารถตอบกลับใน Ticket เดิมได้",
    viewBtn: "ดูรายละเอียด Ticket",
    closedTextLine: (title: string) => `Ticket "${title}" ถูกปิดเรียบร้อยแล้ว`,
    closedNote2: "หากยังมีประเด็นเพิ่มเติม สามารถตอบกลับใน Ticket เดิมได้",
  },
  en: {
    subject: (title: string) => `New message in Ticket: ${title}`,
    greeting: (name: string) => `Hello ${name}`,
    newMsg: (title: string) => `New message in Ticket: ${title}`,
    openBtn: "Open Ticket",
    closedSubject: (title: string) => `Ticket closed: ${title}`,
    closedMsg: (title: string) => `Ticket <strong>${escapeHtml(title)}</strong> has been closed.`,
    closedNote: "If you have further questions, you can reply to the same ticket at any time.",
    viewBtn: "View Ticket",
    closedTextLine: (title: string) => `Ticket "${title}" has been closed.`,
    closedNote2: "If you have further questions, you can reply to the same ticket at any time.",
  },
} as const;

export async function sendTicketEmailToClient(params: {
  to: string;
  toName?: string;
  ticketTitle: string;
  message: string;
  ticketUrl: string;
  apiKey: string;
  db?: DB;
  lang?: EmailLanguage;
}) {
  const { to, toName, ticketTitle, message, ticketUrl, apiKey, db, lang = "th" } = params;
  const s = clientStrings[lang];
  const displayName = toName ?? to;

  const subject = s.subject(ticketTitle);
  const text = [
    s.greeting(displayName),
    "",
    s.newMsg(ticketTitle),
    "",
    message,
    "",
    `${s.openBtn}: ${ticketUrl}`,
    "",
    "— DoAction",
  ].join("\n");
  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;color:#0f172a;">
    ${logoHeaderHtml(ticketUrl)}
    <p>${s.greeting(escapeHtml(displayName))}</p>
    <p>${s.newMsg(escapeHtml(ticketTitle))}</p>
    <blockquote style="margin:12px 0;padding:12px;border-left:3px solid #cbd5e1;background:#f8fafc;">${escapeHtml(message)}</blockquote>
    <p><a href="${ticketUrl}">${s.openBtn}</a></p>
    <p style="color:#64748b;">— DoAction</p>
  </body></html>`;
  await sendEmail({ to, toName, subject, html, text, apiKey, db, source: "ticket_reply_to_client" });
}

// Admin notification emails stay in Thai (admin is always Thai-speaking)
export async function sendTicketEmailToAdmin(params: {
  to: string;
  toName?: string;
  clientName: string;
  ticketTitle: string;
  message: string;
  ticketUrl: string;
  apiKey: string;
  db?: DB;
}) {
  const { to, toName, clientName, ticketTitle, message, ticketUrl, apiKey, db } = params;
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
  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;color:#0f172a;">
    ${logoHeaderHtml(ticketUrl)}
    <p>สวัสดีคุณ ${escapeHtml(toName ?? to)}</p>
    <p>ลูกค้า <strong>${escapeHtml(clientName)}</strong> ตอบกลับ Ticket: <strong>${escapeHtml(ticketTitle)}</strong></p>
    <blockquote style="margin:12px 0;padding:12px;border-left:3px solid #cbd5e1;background:#f8fafc;">${escapeHtml(message)}</blockquote>
    <p><a href="${ticketUrl}">เปิด Ticket ในระบบ</a></p>
    <p style="color:#64748b;">— DoAction</p>
  </body></html>`;
  await sendEmail({ to, toName, subject, html, text, apiKey, db, source: "ticket_reply_to_admin" });
}

export async function sendTicketClosedEmailToClient(params: {
  to: string;
  toName?: string;
  ticketTitle: string;
  ticketUrl: string;
  apiKey: string;
  db?: DB;
  lang?: EmailLanguage;
}) {
  const { to, toName, ticketTitle, ticketUrl, apiKey, db, lang = "th" } = params;
  const s = clientStrings[lang];
  const displayName = toName ?? to;

  const subject = s.closedSubject(ticketTitle);
  const text = [
    s.greeting(displayName),
    "",
    s.closedTextLine(ticketTitle),
    s.closedNote2,
    "",
    `${s.viewBtn}: ${ticketUrl}`,
    "",
    "— DoAction",
  ].join("\n");
  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;color:#0f172a;">
    ${logoHeaderHtml(ticketUrl)}
    <p>${s.greeting(escapeHtml(displayName))}</p>
    <p>${s.closedMsg(ticketTitle)}</p>
    <p>${s.closedNote}</p>
    <p><a href="${ticketUrl}">${s.viewBtn}</a></p>
    <p style="color:#64748b;">— DoAction</p>
  </body></html>`;
  await sendEmail({ to, toName, subject, html, text, apiKey, db, source: "ticket_closed_to_client" });
}
