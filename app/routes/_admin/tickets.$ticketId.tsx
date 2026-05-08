import { Form, redirect, useNavigation } from "react-router";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { requireCoAdminOrAdmin } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";
import { formatDate, generateId } from "~/lib/utils";
import { sendTelegramNotification } from "~/lib/telegram.server";
import {
  sendTicketClosedEmailToClient,
  sendTicketEmailToClient,
} from "~/lib/ticket-email.server";
import { parseClientCcEmails } from "~/lib/client-cc";
import {
  isAllowedAttachment,
  isAttachmentTooLarge,
  prepareAttachmentForUpload,
  cleanupOrphanAttachment,
  uploadAttachment,
} from "~/lib/file-upload.client";
import type { SupportTicket, TicketAttachment, TicketMessage, User, Client } from "~/types";
import StatusBadge from "~/components/tickets/StatusBadge";
import PriorityBadge from "~/components/tickets/PriorityBadge";
import MessageBubble from "~/components/tickets/MessageBubble";
import { useT } from "~/lib/i18n";
import type { TranslationKey } from "~/lib/translations";
import { FaPaperclip, FaArrowLeft, FaX, FaTrash } from "react-icons/fa6";

const ReplySchema = z.object({
  message: z.string().default(""),
  is_internal: z.string().optional(),
  intent: z.enum(["reply", "status", "delete"]).default("reply"),
  status: z.string().optional(),
});

export function meta({ data }: any) {
  const ticket = data?.ticket as SupportTicket | undefined;
  return [{ title: ticket ? `Ticket: ${ticket.title} — Admin` : "Ticket — Admin" }];
}

export async function loader({ request, context, params }: any) {
  const env = context.cloudflare.env;
  const currentUser = await requireCoAdminOrAdmin(request, env.DB, env.SESSIONPORTAL);
  const db = createDB(env.DB);

  const ticket = await db.getTicket(params.ticketId);
  if (!ticket) throw new Response("Ticket not found", { status: 404 });

  if (currentUser.role === "co-admin") {
    const assignments = await db.listCoAdminClients(currentUser.id);
    const assignedClientIds = assignments.map((a: any) => a.client_id);
    if (!assignedClientIds.includes(ticket.client_id)) {
      throw new Response("You don't have access to this ticket", { status: 403 });
    }
  }

  const [messages, attachments, admins, coAdmins, client] = await Promise.all([
    db.listMessagesByTicket(ticket.id),
    db.listAttachmentsByTicket(ticket.id),
    db.listAdminUsers(),
    db.listCoAdminUsers(),
    db.getClientById(ticket.client_id),
  ]);

  const usersById: Record<string, User> = {};
  for (const a of admins) usersById[a.id] = a;
  for (const a of coAdmins) usersById[a.id] = a;

  return { ticket, messages, attachments, usersById, client, currentUser };
}

const STATUSES = ["open", "in_progress", "waiting", "resolved", "closed"] as const;

function statusToKey(status: (typeof STATUSES)[number]): TranslationKey {
  if (status === "closed") return "status_closed_short";
  return `status_${status}` as TranslationKey;
}

const STATUS_LABEL_TH: Record<string, string> = {
  open: "เปิด", in_progress: "กำลังดำเนิน", waiting: "รอข้อมูล", resolved: "เสร็จสิ้น", closed: "ปิด",
};

export async function action({ request, context, params }: any) {
  const env = context.cloudflare.env;
  const currentUser = await requireCoAdminOrAdmin(request, env.DB, env.SESSIONPORTAL);
  const db = createDB(env.DB);

  const ticket = await db.getTicket(params.ticketId);
  if (!ticket) throw new Response("Ticket not found", { status: 404 });

  if (currentUser.role === "co-admin") {
    const assignments = await db.listCoAdminClients(currentUser.id);
    const assignedClientIds = assignments.map((a: any) => a.client_id);
    if (!assignedClientIds.includes(ticket.client_id)) {
      throw new Response("You don't have access to this ticket", { status: 403 });
    }
  }

  const formData = await request.formData();
  const parsed = ReplySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };

  const { intent, message, is_internal, status } = parsed.data;
  if (intent === "reply" && !message.trim()) return { errors: { message: ["กรุณาพิมพ์ข้อความ"] } };

  if (intent === "delete") {
    await db.softDeleteTicket(ticket.id, currentUser.id);
    return redirect("/admin/tickets");
  }

  if (intent === "status" && status) {
    const updateData: any = { status };
    if (status === "resolved") updateData.resolved_at = Math.floor(Date.now() / 1000);
    if (status === "open" || status === "in_progress") updateData.resolved_at = null;
    await db.updateTicket(ticket.id, updateData);

    const client = await db.getClientById(ticket.client_id);
    if (client) {
      const clientUser = await db.getUserById(client.user_id);
      const notification = {
        id: generateId(), user_id: client.user_id, type: "ticket_update",
        title: `Ticket อัปเดต: ${ticket.title}`,
        body: `สถานะเปลี่ยนเป็น ${STATUS_LABEL_TH[status] ?? status}`,
        link: `/tickets/${ticket.id}`, read: 0,
      } as const;
      await db.createNotification(notification);
      const coAdmins = await db.getCoAdminEmailsForClient(client.id);
      const customerCcEmails = parseClientCcEmails(client.cc_emails).map((email: string) => ({ email }));
      const ccRecipients = [...coAdmins, ...customerCcEmails];
      context.cloudflare.ctx.waitUntil(
        Promise.allSettled([
          sendTelegramNotification({ db, appUrl: env.APP_URL, notification }),
          status === "closed" && clientUser?.email && env.SEND_EMAIL
            ? sendTicketClosedEmailToClient({
                to: clientUser.email, toName: clientUser.name, ticketTitle: ticket.title,
                ticketUrl: `${env.APP_URL}/tickets/${ticket.id}`, sendEmail: env.SEND_EMAIL,
                cc: ccRecipients, db, lang: clientUser.language === "en" ? "en" : "th",
              })
            : Promise.resolve(),
        ])
      );
    }
    return redirect(`/admin/tickets/${ticket.id}`);
  }

  const isInternal = is_internal === "1" ? 1 : 0;
  const messageId = generateId();
  await db.createTicketMessage({ id: messageId, ticket_id: ticket.id, user_id: currentUser.id, message, is_internal: isInternal });

  const attachmentsRaw = formData.get("attachments_json");
  if (typeof attachmentsRaw === "string" && attachmentsRaw.trim()) {
    try {
      const items = JSON.parse(attachmentsRaw) as Array<{ fileKey: string; fileName: string; mimeType: string; sizeBytes: number }>;
      for (const item of items) {
        if (!item?.fileKey) continue;
        await db.createTicketAttachment({
          id: generateId(), ticket_id: ticket.id, message_id: messageId,
          uploader_user_id: currentUser.id, file_key: item.fileKey,
          file_name: item.fileName || "attachment", mime_type: item.mimeType || "application/octet-stream",
          size_bytes: Number(item.sizeBytes) || 0,
        });
      }
    } catch { /* ignore */ }
  }

  if (!isInternal) {
    if (ticket.status === "open") await db.updateTicket(ticket.id, { status: "in_progress" });
    const client = await db.getClientById(ticket.client_id);
    if (client) {
      const clientUser = await db.getUserById(client.user_id);
      const notification = {
        id: generateId(), user_id: client.user_id, type: "ticket_reply",
        title: `มีข้อความใหม่ใน: ${ticket.title}`,
        body: message.slice(0, 100), link: `/tickets/${ticket.id}`, read: 0,
      } as const;
      await db.createNotification(notification);
      const coAdmins = await db.getCoAdminEmailsForClient(client.id);
      const customerCcEmails = parseClientCcEmails(client.cc_emails).map((email: string) => ({ email }));
      const ccRecipients = [...coAdmins, ...customerCcEmails];
      context.cloudflare.ctx.waitUntil(
        Promise.allSettled([
          sendTelegramNotification({ db, appUrl: env.APP_URL, notification }),
          clientUser?.email && env.SEND_EMAIL
            ? sendTicketEmailToClient({
                to: clientUser.email, toName: clientUser.name, ticketTitle: ticket.title,
                message, ticketUrl: `${env.APP_URL}/tickets/${ticket.id}`, sendEmail: env.SEND_EMAIL,
                cc: ccRecipients, db, lang: clientUser.language === "en" ? "en" : "th",
              })
            : Promise.resolve(),
        ])
      );
    }
  }

  return redirect(`/admin/tickets/${ticket.id}`);
}

export default function AdminTicketDetailPage({ loaderData, actionData }: any) {
  const { ticket, messages, attachments, usersById, client, currentUser } = loaderData as {
    ticket: SupportTicket;
    messages: TicketMessage[];
    attachments: TicketAttachment[];
    usersById: Record<string, User>;
    client: Client | null;
    currentUser: User;
  };
  const errors = actionData?.errors;
  const { t, lang } = useT();
  const navigation = useNavigation();
  const isSubmitting = navigation.state !== "idle";
  const formRef = useRef<HTMLFormElement | null>(null);
  const isSubmittingReplyRef = useRef(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState("");
  const [uploadedFiles, setUploadedFiles] = useState<
    Array<{ fileKey: string; fileName: string; mimeType: string; sizeBytes: number; url: string }>
  >([]);

  const attachmentsByMessage = attachments.reduce<Record<string, TicketAttachment[]>>((acc, a) => {
    (acc[a.message_id] ||= []).push(a);
    return acc;
  }, {});

  useEffect(() => {
    if (navigation.state !== "idle" || !isSubmittingReplyRef.current) return;
    if (errors?.message) { isSubmittingReplyRef.current = false; return; }
    formRef.current?.reset();
    setUploadedFiles([]);
    setUploadError("");
    isSubmittingReplyRef.current = false;
  }, [navigation.state, errors?.message]);

  useEffect(() => {
    const cleanup = () => {
      if (isSubmittingReplyRef.current || uploadedFiles.length === 0) return;
      for (const f of uploadedFiles) void cleanupOrphanAttachment({ ticketId: ticket.id, fileKey: f.fileKey });
    };
    window.addEventListener("beforeunload", cleanup);
    return () => { window.removeEventListener("beforeunload", cleanup); cleanup(); };
  }, [ticket.id, uploadedFiles]);

  async function onAttachmentSelect(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setUploadError("");
    setUploading(true);
    setUploadProgress(0);
    try {
      for (const rawFile of Array.from(fileList)) {
        if (!isAllowedAttachment(rawFile)) throw new Error("PDF, image, and video only");
        const prepared = await prepareAttachmentForUpload(rawFile);
        if (isAttachmentTooLarge(prepared)) throw new Error("Max file size is 2MB");
        const uploaded = await uploadAttachment({ ticketId: ticket.id, file: prepared, onProgress: (p) => setUploadProgress(p) });
        setUploadedFiles((prev) => [...prev, uploaded]);
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  }

  return (
    <div className="max-w-4xl space-y-5">

      {/* ── Header ── */}
      <div>
        <a href="/admin/tickets" className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 transition-colors mb-4">
          <FaArrowLeft className="text-[10px]" />
          {t("admin_breadcrumb_tickets")}
        </a>

        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div className="space-y-2 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-slate-500 font-mono">#{ticket.id.slice(0, 8)}</span>
                {client && (
                  <a href={`/admin/clients/${ticket.client_id}`} className="text-xs text-violet-600 hover:underline underline-offset-2">
                    {client.company_name}
                  </a>
                )}
              </div>
              <h1 className="text-xl font-semibold text-slate-900 leading-snug">{ticket.title}</h1>
              <div className="flex items-center gap-2 flex-wrap">
                <StatusBadge status={ticket.status} />
                <PriorityBadge priority={ticket.priority} />
                <span className="text-xs text-slate-500">{t("admin_ticket_meta_opened")} {formatDate(ticket.created_at, lang)}</span>
              </div>
            </div>
            <Form
              method="post"
              onSubmit={(e) => {
                if (!confirm(`ลบ Ticket "${ticket.title}" ใช่หรือไม่? Ticket จะถูกย้ายไปถังขยะ`)) e.preventDefault();
              }}
            >
              <input type="hidden" name="intent" value="delete" />
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-100 transition-colors shrink-0"
              >
                <FaTrash className="text-[10px]" />
                ลบ Ticket
              </button>
            </Form>
          </div>
        </div>
      </div>

      {/* ── Status switcher ── */}
      <div className="bg-white rounded-xl border border-slate-200 px-5 py-4">
        <p className="text-xs font-medium text-slate-500 mb-3">{t("admin_ticket_change_status")}</p>
        <Form method="post" className="flex flex-wrap gap-2">
          <input type="hidden" name="intent" value="status" />
          {STATUSES.map((s) => (
            <button
              key={s}
              type="submit"
              name="status"
              value={s}
              disabled={ticket.status === s || isSubmitting}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                ticket.status === s
                  ? "bg-slate-900 text-white border-slate-900 cursor-default"
                  : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
              }`}
            >
              {t(statusToKey(s))}
            </button>
          ))}
        </Form>
      </div>

      {/* ── Message thread ── */}
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
        <MessageBubble message={ticket.description} isClient={false} isInternal={false} />
        {messages.map((msg) => {
          const userRole = usersById[msg.user_id]?.role;
          const isFromAdmin = userRole === "admin" || userRole === "co-admin";
          return (
            <div key={msg.id} id={`msg-${msg.id}`}>
              <MessageBubble
                message={msg.message}
                isClient={isFromAdmin}
                isInternal={msg.is_internal === 1}
                authorName={usersById[msg.user_id]?.name}
                attachments={(attachmentsByMessage[msg.id] ?? []).map((att) => ({
                  id: att.id,
                  name: att.file_name,
                  href: `/api/attachments/${encodeURIComponent(att.file_key)}`,
                }))}
              />
            </div>
          );
        })}
      </div>

      {/* ── Reply form ── */}
      <div key={messages.length} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100">
          <p className="text-sm font-semibold text-slate-900">{t("admin_ticket_reply_label")}</p>
        </div>
        <Form ref={formRef} method="post" className="p-5 space-y-4">
          <input type="hidden" name="intent" value="reply" />
          <input type="hidden" name="attachments_json" value={JSON.stringify(uploadedFiles)} />

          <textarea
            name="message"
            rows={4}
            className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-400 transition resize-none"
            placeholder={t("admin_ticket_ph_reply")}
          />
          {errors?.message && <p className="text-xs text-rose-600">{errors.message[0]}</p>}

          {/* Attachment area */}
          <div className="space-y-2">
            <label className="inline-flex items-center gap-2 cursor-pointer text-xs font-medium text-slate-600 border border-slate-200 bg-slate-50 hover:bg-slate-100 rounded-lg px-3 py-2 transition-colors">
              <FaPaperclip className="text-slate-500 text-[11px]" />
              Attach file
              <input
                type="file"
                accept="application/pdf,image/*,video/*"
                multiple
                onChange={(e) => void onAttachmentSelect(e.target.files)}
                className="sr-only"
              />
            </label>
            <p className="text-[11px] text-slate-500">PDF / Image / Video — max 2 MB each</p>

            {uploading && (
              <div className="space-y-1.5">
                <p className="text-xs text-slate-500">Uploading… {uploadProgress}%</p>
                <div className="h-1.5 w-full rounded-full bg-slate-200 overflow-hidden">
                  <div className="h-full bg-violet-500 transition-all duration-150" style={{ width: `${uploadProgress}%` }} />
                </div>
              </div>
            )}
            {uploadError && <p className="text-xs text-rose-600">{uploadError}</p>}
            {uploadedFiles.length > 0 && (
              <ul className="space-y-1.5">
                {uploadedFiles.map((f) => (
                  <li key={f.fileKey} className="flex items-center justify-between gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                    <span className="flex items-center gap-1.5 text-xs text-slate-600 min-w-0">
                      <FaPaperclip className="text-slate-500 shrink-0 text-[10px]" />
                      <span className="truncate">{f.fileName}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setUploadedFiles((prev) => prev.filter((item) => item.fileKey !== f.fileKey));
                        void cleanupOrphanAttachment({ ticketId: ticket.id, fileKey: f.fileKey });
                      }}
                      className="shrink-0 p-1 rounded text-slate-500 hover:text-rose-500 hover:bg-rose-50 transition-colors"
                      aria-label="Remove"
                    >
                      <FaX className="text-[9px]" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between pt-1">
            <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer select-none">
              <input
                type="checkbox"
                name="is_internal"
                value="1"
                className="rounded border-slate-300 accent-violet-600"
              />
              {t("admin_ticket_internal_note")}
            </label>
            <button
              type="submit"
              disabled={uploading || isSubmitting}
              onClick={() => { isSubmittingReplyRef.current = true; }}
              className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-5 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50 transition-colors"
            >
              {uploading ? "Uploading…" : isSubmitting ? "Sending…" : t("admin_ticket_send")}
            </button>
          </div>
        </Form>
      </div>
    </div>
  );
}
