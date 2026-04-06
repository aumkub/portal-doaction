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
import {
  isAllowedAttachment,
  isAttachmentTooLarge,
  prepareAttachmentForUpload,
  cleanupOrphanAttachment,
  uploadAttachment,
} from "~/lib/file-upload.client";
import type {
  SupportTicket,
  TicketAttachment,
  TicketMessage,
  User,
  Client,
} from "~/types";
import StatusBadge from "~/components/tickets/StatusBadge";
import PriorityBadge from "~/components/tickets/PriorityBadge";
import MessageBubble from "~/components/tickets/MessageBubble";
import PageHeader from "~/components/layout/PageHeader";
import { useT } from "~/lib/i18n";
import type { TranslationKey } from "~/lib/translations";
import { FaPaperclip } from "react-icons/fa6";

const ReplySchema = z.object({
  message: z.string().default(""),
  is_internal: z.string().optional(),
  intent: z.enum(["reply", "status"]).default("reply"),
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

  // For Co-Admins, verify they have access to this ticket's client
  if (currentUser.role === "co-admin") {
    const assignments = await db.listCoAdminClients(currentUser.id);
    const assignedClientIds = assignments.map((a) => a.client_id);
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

const STATUSES = [
  "open",
  "in_progress",
  "waiting",
  "resolved",
  "closed",
] as const;

function statusToKey(status: (typeof STATUSES)[number]): TranslationKey {
  if (status === "closed") return "status_closed_short";
  return `status_${status}` as TranslationKey;
}

/** Thai labels for server-side notifications to clients */
const STATUS_LABEL_TH: Record<string, string> = {
  open: "เปิด",
  in_progress: "กำลังดำเนิน",
  waiting: "รอข้อมูล",
  resolved: "เสร็จสิ้น",
  closed: "ปิด",
};

export async function action({ request, context, params }: any) {
  const env = context.cloudflare.env;
  const currentUser = await requireCoAdminOrAdmin(request, env.DB, env.SESSIONPORTAL);
  const db = createDB(env.DB);

  const ticket = await db.getTicket(params.ticketId);
  if (!ticket) throw new Response("Ticket not found", { status: 404 });

  // For Co-Admins, verify they have access to this ticket's client
  if (currentUser.role === "co-admin") {
    const assignments = await db.listCoAdminClients(currentUser.id);
    const assignedClientIds = assignments.map((a) => a.client_id);
    if (!assignedClientIds.includes(ticket.client_id)) {
      throw new Response("You don't have access to this ticket", { status: 403 });
    }
  }

  const formData = await request.formData();
  const raw = Object.fromEntries(formData);
  const parsed = ReplySchema.safeParse(raw);
  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const { intent, message, is_internal, status } = parsed.data;

  // Validate message only for reply intent
  if (intent === "reply" && !message.trim()) {
    return { errors: { message: ["กรุณาพิมพ์ข้อความ"] } };
  }

  if (intent === "status" && status) {
    const updateData: any = { status };
    if (status === "resolved") updateData.resolved_at = Math.floor(Date.now() / 1000);
    if (status === "open" || status === "in_progress") updateData.resolved_at = null;
    await db.updateTicket(ticket.id, updateData);

    // Notify client of status change
    const client = await db.getClientById(ticket.client_id);
    if (client) {
      const clientUser = await db.getUserById(client.user_id);
      const statusLabel = status ? STATUS_LABEL_TH[status] ?? status : "";
      const notification = {
        id: generateId(),
        user_id: client.user_id,
        type: "ticket_update",
        title: `Ticket อัปเดต: ${ticket.title}`,
        body: `สถานะเปลี่ยนเป็น ${statusLabel}`,
        link: `/tickets/${ticket.id}`,
        read: 0,
      } as const;
      await db.createNotification(notification);

      // Get co-admins for CC
      const coAdmins = await db.getCoAdminEmailsForClient(client.id);

      context.cloudflare.ctx.waitUntil(
        Promise.allSettled([
          sendTelegramNotification({
            db,
            appUrl: env.APP_URL,
            notification,
          }),
          status === "closed" && clientUser?.email && env.SMTP2GO_API_KEY
            ? sendTicketClosedEmailToClient({
                to: clientUser.email,
                toName: clientUser.name,
                ticketTitle: ticket.title,
                ticketUrl: `${env.APP_URL}/tickets/${ticket.id}`,
                apiKey: env.SMTP2GO_API_KEY,
                cc: coAdmins,
                db,
                lang: clientUser.language === "en" ? "en" : "th",
              })
            : Promise.resolve(),
        ])
      );
    }
    return redirect(`/admin/tickets/${ticket.id}`);
  }

  // Reply
  const isInternal = is_internal === "1" ? 1 : 0;
  const messageId = generateId();
  await db.createTicketMessage({
    id: messageId,
    ticket_id: ticket.id,
    user_id: currentUser.id,
    message,
    is_internal: isInternal,
  });

  const attachmentsRaw = formData.get("attachments_json");
  if (typeof attachmentsRaw === "string" && attachmentsRaw.trim() !== "") {
    try {
      const items = JSON.parse(attachmentsRaw) as Array<{
        fileKey: string;
        fileName: string;
        mimeType: string;
        sizeBytes: number;
      }>;
      for (const item of items) {
        if (!item?.fileKey) continue;
        await db.createTicketAttachment({
          id: generateId(),
          ticket_id: ticket.id,
          message_id: messageId,
          uploader_user_id: currentUser.id,
          file_key: item.fileKey,
          file_name: item.fileName || "attachment",
          mime_type: item.mimeType || "application/octet-stream",
          size_bytes: Number(item.sizeBytes) || 0,
        });
      }
    } catch {
      // ignore malformed attachment payload
    }
  }

  if (!isInternal) {
    // Update status to in_progress when admin replies
    if (ticket.status === "open") {
      await db.updateTicket(ticket.id, { status: "in_progress" });
    }

    // Notify client
    const client = await db.getClientById(ticket.client_id);
    if (client) {
      const clientUser = await db.getUserById(client.user_id);
      const notification = {
        id: generateId(),
        user_id: client.user_id,
        type: "ticket_reply",
        title: `มีข้อความใหม่ใน: ${ticket.title}`,
        body: message.slice(0, 100),
        link: `/tickets/${ticket.id}`,
        read: 0,
      } as const;
      await db.createNotification(notification);
      const messageSnapshot = message;

      // Get co-admins for CC
      const coAdmins = await db.getCoAdminEmailsForClient(client.id);

      context.cloudflare.ctx.waitUntil(
        Promise.allSettled([
          sendTelegramNotification({
            db,
            appUrl: env.APP_URL,
            notification,
          }),
          clientUser?.email && env.SMTP2GO_API_KEY
            ? sendTicketEmailToClient({
                to: clientUser.email,
                toName: clientUser.name,
                ticketTitle: ticket.title,
                message: messageSnapshot,
                ticketUrl: `${env.APP_URL}/tickets/${ticket.id}`,
                apiKey: env.SMTP2GO_API_KEY,
                cc: coAdmins,
                db,
                lang: clientUser.language === "en" ? "en" : "th",
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
    admin: User;
  };
  const errors = actionData?.errors;
  const { t, lang } = useT();
  const navigation = useNavigation();
  const isSubmitting = navigation.state !== "idle";
  const formRef = useRef<HTMLFormElement | null>(null);
  const isSubmittingReplyRef = useRef(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string>("");
  const [uploadedFiles, setUploadedFiles] = useState<
    Array<{ fileKey: string; fileName: string; mimeType: string; sizeBytes: number; url: string }>
  >([]);
  const attachmentsByMessage = attachments.reduce<Record<string, TicketAttachment[]>>(
    (acc, a) => {
      (acc[a.message_id] ||= []).push(a);
      return acc;
    },
    {}
  );

  useEffect(() => {
    if (navigation.state !== "idle") return;
    if (!isSubmittingReplyRef.current) return;
    if (errors?.message) {
      isSubmittingReplyRef.current = false;
      return;
    }

    formRef.current?.reset();
    setUploadedFiles([]);
    setUploadError("");
    isSubmittingReplyRef.current = false;
  }, [navigation.state, errors?.message]);

  useEffect(() => {
    const cleanupPendingUploads = () => {
      if (isSubmittingReplyRef.current || uploadedFiles.length === 0) return;
      for (const f of uploadedFiles) {
        void cleanupOrphanAttachment({ ticketId: ticket.id, fileKey: f.fileKey });
      }
    };

    const onBeforeUnload = () => cleanupPendingUploads();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      cleanupPendingUploads();
    };
  }, [ticket.id, uploadedFiles]);

  async function onAttachmentSelect(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setUploadError("");
    setUploading(true);
    setUploadProgress(0);
    try {
      for (const rawFile of Array.from(fileList)) {
        if (!isAllowedAttachment(rawFile)) {
          throw new Error("PDF, image, and video only");
        }
        const prepared = await prepareAttachmentForUpload(rawFile);
        if (isAttachmentTooLarge(prepared)) {
          throw new Error("Max file size is 2MB");
        }
        const uploaded = await uploadAttachment({
          ticketId: ticket.id,
          file: prepared,
          onProgress: (percent) => setUploadProgress(percent),
        });
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
    <div className="max-w-4xl space-y-6">
      <PageHeader
        title={ticket.title}
        subtitle={client?.company_name ?? undefined}
        breadcrumbs={[
          { label: t("admin_breadcrumb_admin") },
          { label: t("admin_breadcrumb_tickets"), href: "/admin/tickets" },
          { label: `#${ticket.id.slice(0, 8)}` },
        ]}
      />

      {/* Meta row */}
      <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-4">
        <div>
          <p className="text-xs text-slate-500 mb-1">{t("admin_ticket_meta_status")}</p>
          <StatusBadge status={ticket.status} />
        </div>
        <div>
          <p className="text-xs text-slate-500 mb-1">{t("admin_ticket_meta_priority")}</p>
          <PriorityBadge priority={ticket.priority} />
        </div>
        <div>
          <p className="text-xs text-slate-500 mb-1">{t("admin_ticket_meta_client")}</p>
          <p className="text-sm font-medium text-slate-700">{client?.company_name ?? "—"}</p>
        </div>
        <div>
          <p className="text-xs text-slate-500 mb-1">{t("admin_ticket_meta_opened")}</p>
          <p className="text-sm text-slate-700">{formatDate(ticket.created_at, lang)}</p>
        </div>
      </div>

      {/* Status change */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-xs font-medium text-slate-600 mb-3">
          {t("admin_ticket_change_status")}
        </p>
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

      {/* Message thread */}
      <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <MessageBubble message={ticket.description} isClient={false} isInternal={false} />
        {messages.map((msg) => {
          const userRole = usersById[msg.user_id]?.role;
          const isFromAdminOrCoAdmin = userRole === "admin" || userRole === "co-admin";
          return (
            <div key={msg.id} id={`msg-${msg.id}`}>
              <MessageBubble
                message={msg.message}
                isClient={isFromAdminOrCoAdmin}
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

      {/* Reply form */}
      <div key={messages.length} className="rounded-2xl border border-slate-200 bg-white p-4">
        <Form method="post" className="space-y-3">
          <input type="hidden" name="intent" value="reply" />
          <input type="hidden" name="attachments_json" value={JSON.stringify(uploadedFiles)} />
          <label className="block text-sm font-medium text-slate-700">
            {t("admin_ticket_reply_label")}
          </label>
          <textarea
            name="message"
            rows={4}
            required
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
            placeholder={t("admin_ticket_ph_reply")}
          />
          {errors?.message && (
            <p className="text-xs text-rose-600">{errors.message[0]}</p>
          )}
          <div className="space-y-1">
            <label className="block text-xs font-medium text-slate-600">
              Attach file (PDF/Image/Video, max 2MB)
            </label>
            <input
              type="file"
              accept="application/pdf,image/*,video/*"
              multiple
              onChange={(e) => void onAttachmentSelect(e.target.files)}
              className="block w-full text-xs text-slate-600 file:mr-3 file:rounded-md file:border file:border-slate-200 file:bg-white file:px-2.5 file:py-2 mt-2"
            />
            {uploading ? (
              <div className="space-y-2 mt-2">
                <p className="text-xs text-slate-500">Uploading... {uploadProgress}%</p>
                <div className="h-1.5 w-full rounded bg-slate-200 overflow-hidden">
                  <div
                    className="h-full bg-violet-600 transition-all"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              </div>
            ) : null}
            {uploadError ? <p className="text-xs text-rose-600">{uploadError}</p> : null}
            {uploadedFiles.length > 0 ? (
              <ul className="text-xs text-slate-600 space-y-2 mt-2 max-w-[500px] bg-slate-100 rounded-lg p-2">
                {uploadedFiles.map((f) => (
                  <li
                    key={f.fileKey}
                    className="flex items-center justify-between gap-2 bg-slate-50 rounded px-2 py-1"
                  >
                    <span>
                      <FaPaperclip className="inline mr-1" aria-hidden="true" />
                      {f.fileName}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setUploadedFiles((prev) =>
                          prev.filter((item) => item.fileKey !== f.fileKey)
                        );
                        void cleanupOrphanAttachment({ ticketId: ticket.id, fileKey: f.fileKey });
                      }}
                      className="rounded border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-500 hover:bg-slate-50"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer select-none">
              <input
                type="checkbox"
                name="is_internal"
                value="1"
                className="rounded border-slate-300 text-violet-600 focus:ring-violet-500"
              />
              {t("admin_ticket_internal_note")}
            </label>
            <button
              type="submit"
              disabled={uploading || isSubmitting}
              className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 transition-colors"
            >
              {uploading ? "Uploading..." : isSubmitting ? "Sending..." : t("admin_ticket_send")}
            </button>
          </div>
        </Form>
      </div>
    </div>
  );
}
