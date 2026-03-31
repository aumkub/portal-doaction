import { Form, redirect } from "react-router";
import { useState } from "react";
import { z } from "zod";
import { requireAdmin } from "~/lib/auth.server";
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
  const admin = await requireAdmin(request, env.DB, env.SESSIONPORTAL);
  const db = createDB(env.DB);

  const ticket = await db.getTicket(params.ticketId);
  if (!ticket) throw new Response("Ticket not found", { status: 404 });

  const [messages, attachments, admins, client] = await Promise.all([
    db.listMessagesByTicket(ticket.id),
    db.listAttachmentsByTicket(ticket.id),
    db.listAdminUsers(),
    db.getClientById(ticket.client_id),
  ]);

  const usersById: Record<string, User> = {};
  for (const a of admins) usersById[a.id] = a;

  return { ticket, messages, attachments, usersById, client, admin };
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

function getAttachmentIcon(fileName: string, mimeType?: string): string {
  const lower = fileName.toLowerCase();
  if (mimeType === "application/pdf" || lower.endsWith(".pdf")) return "📄";
  if (mimeType?.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg)$/.test(lower)) return "🖼️";
  if (mimeType?.startsWith("video/") || /\.(mp4|mov|webm|mkv|avi)$/.test(lower)) return "🎬";
  return "📎";
}

export async function action({ request, context, params }: any) {
  const env = context.cloudflare.env;
  const admin = await requireAdmin(request, env.DB, env.SESSIONPORTAL);
  const db = createDB(env.DB);

  const ticket = await db.getTicket(params.ticketId);
  if (!ticket) throw new Response("Ticket not found", { status: 404 });

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
      await sendTelegramNotification({
        db,
        appUrl: env.APP_URL,
        notification,
      });

      if (status === "closed" && clientUser?.email && env.SMTP2GO_API_KEY) {
        const ticketUrl = `${env.APP_URL}/tickets/${ticket.id}`;
        await sendTicketClosedEmailToClient({
          to: clientUser.email,
          toName: clientUser.name,
          ticketTitle: ticket.title,
          ticketUrl,
          apiKey: env.SMTP2GO_API_KEY,
        });
      }
    }
    return redirect(`/admin/tickets/${ticket.id}`);
  }

  // Reply
  const isInternal = is_internal === "1" ? 1 : 0;
  const messageId = generateId();
  await db.createTicketMessage({
    id: messageId,
    ticket_id: ticket.id,
    user_id: admin.id,
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
          uploader_user_id: admin.id,
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
      await sendTelegramNotification({
        db,
        appUrl: env.APP_URL,
        notification,
      });
      if (clientUser?.email && env.SMTP2GO_API_KEY) {
        const ticketUrl = `${env.APP_URL}/tickets/${ticket.id}`;
        await sendTicketEmailToClient({
          to: clientUser.email,
          toName: clientUser.name,
          ticketTitle: ticket.title,
          message,
          ticketUrl,
          apiKey: env.SMTP2GO_API_KEY,
        });
      }
    }
  }

  return redirect(`/admin/tickets/${ticket.id}`);
}

export default function AdminTicketDetailPage({ loaderData, actionData }: any) {
  const { ticket, messages, attachments, usersById, client } = loaderData as {
    ticket: SupportTicket;
    messages: TicketMessage[];
    attachments: TicketAttachment[];
    usersById: Record<string, User>;
    client: Client | null;
  };
  const errors = actionData?.errors;
  const { t, lang } = useT();
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
              disabled={ticket.status === s}
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
        <MessageBubble message={ticket.description} isClient={true} isInternal={false} />
        {messages.map((msg) => (
          <div key={msg.id} id={`msg-${msg.id}`}>
            <MessageBubble
              message={msg.message}
              isClient={usersById[msg.user_id]?.role !== "admin"}
              isInternal={msg.is_internal === 1}
              authorName={usersById[msg.user_id]?.name}
              attachments={(attachmentsByMessage[msg.id] ?? []).map((att) => ({
                id: att.id,
                name: att.file_name,
                href: `/api/attachments/${encodeURIComponent(att.file_key)}`,
                icon: getAttachmentIcon(att.file_name, att.mime_type),
              }))}
            />
          </div>
        ))}
      </div>

      {/* Reply form */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
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
              <ul className="text-xs text-slate-600 space-y-2 mt-2 max-w-[500px]">
                {uploadedFiles.map((f) => (
                  <li key={f.fileKey} className="flex items-center justify-between gap-2">
                    <span>
                      {getAttachmentIcon(f.fileName, f.mimeType)} {f.fileName}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setUploadedFiles((prev) =>
                          prev.filter((item) => item.fileKey !== f.fileKey)
                        )
                      }
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
              className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 transition-colors"
            >
              {t("admin_ticket_send")}
            </button>
          </div>
        </Form>
      </div>
    </div>
  );
}
