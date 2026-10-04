import { Form, Link, redirect, useNavigation } from "react-router";
import { ChatThread } from "~/components/tickets/ChatThread";
import { sendOrHoldTicketEmail } from "~/lib/email-alerts.server";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { requireUser } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";
import { formatDate, generateId } from "~/lib/utils";
import { sendTelegramNotification } from "~/lib/telegram.server";
import { sendTicketEmailToAdmin } from "~/lib/ticket-email.server";
import {
  isAllowedAttachment,
  isAttachmentTooLarge,
  prepareAttachmentForUpload,
  cleanupOrphanAttachment,
  uploadAttachment,
} from "~/lib/file-upload.client";
import { useT } from "~/lib/i18n";
import type { SupportTicket, TicketAttachment, TicketMessage, User } from "~/types";
import StatusBadge from "~/components/tickets/StatusBadge";
import { StatusStepper } from "~/components/tickets/StatusStepper";
import PriorityBadge from "~/components/tickets/PriorityBadge";
import MessageBubble from "~/components/tickets/MessageBubble";
import AttachmentLightbox from "~/components/tickets/AttachmentLightbox";
import type { LightboxItem } from "~/components/tickets/AttachmentLightbox";

const ReplySchema = z.object({
  message: z.string().min(1, "กรุณาพิมพ์ข้อความ"),
});

type LoaderData = {
  ticket: SupportTicket;
  messages: TicketMessage[];
  attachments: TicketAttachment[];
  usersById: Record<string, User>;
  currentUserId: string;
};

function getAttachmentIcon(fileName: string, mimeType?: string): string {
  const lower = fileName.toLowerCase();
  if (mimeType === "application/pdf" || lower.endsWith(".pdf")) return "📄";
  if (mimeType?.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg)$/.test(lower)) return "🖼️";
  if (mimeType?.startsWith("video/") || /\.(mp4|mov|webm|mkv|avi)$/.test(lower)) return "🎬";
  return "📎";
}

/**
 * Load a ticket for the signed-in client, or throw. This route is the client
 * view only, so other roles are refused rather than shown every ticket.
 */
async function getOwnTicket(db: ReturnType<typeof createDB>, user: User, ticketId: string) {
  const ticket = await db.getTicket(ticketId);
  if (!ticket || ticket.deleted_at) throw new Response("Ticket not found", { status: 404 });
  if (user.role !== "client") throw new Response("Forbidden", { status: 403 });
  const client = await db.getClientByUserId(user.id);
  if (!client || client.id !== ticket.client_id) {
    throw new Response("Forbidden", { status: 403 });
  }
  return ticket;
}

export async function loader({ request, context, params }: any) {
  const user = await requireUser(
    request,
    context.cloudflare.env.DB,
    context.cloudflare.env.SESSIONPORTAL
  );
  const db = createDB(context.cloudflare.env.DB);
  const ticket = await getOwnTicket(db, user, params.ticketId);

  const [allMessages, allAttachments, admins] = await Promise.all([
    db.listMessagesByTicket(ticket.id),
    db.listAttachmentsByTicket(ticket.id),
    db.listAdminUsers(),
  ]);
  // Internal notes and their files must never leave the server for a client.
  const messages = allMessages.filter((m) => m.is_internal === 0);
  const visibleIds = new Set(messages.map((m) => m.id));
  const attachments = allAttachments.filter((a) => visibleIds.has(a.message_id));

  const usersById: Record<string, User> = {};
  for (const admin of admins) usersById[admin.id] = admin;
  usersById[user.id] = user;

  return { ticket, messages, attachments, usersById, currentUserId: user.id };
}

export async function action({ request, context, params }: any) {
  const env = context.cloudflare.env;
  const user = await requireUser(
    request,
    env.DB,
    env.SESSIONPORTAL
  );
  const db = createDB(env.DB);
  const ticket = await getOwnTicket(db, user, params.ticketId);

  const formData = await request.formData();
  const parsed = ReplySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const messageId = generateId();
  await db.createTicketMessage({
    id: messageId,
    ticket_id: ticket.id,
    user_id: user.id,
    message: parsed.data.message,
    is_internal: 0,
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
        // Uploads are keyed by ticket; refuse keys minted for another ticket.
        if (!item?.fileKey?.startsWith(`ticket_${ticket.id}_`)) continue;
        await db.createTicketAttachment({
          id: generateId(),
          ticket_id: ticket.id,
          message_id: messageId,
          uploader_user_id: user.id,
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

  if (ticket.status === "resolved" || ticket.status === "closed") {
    await db.updateTicket(ticket.id, { status: "in_progress", resolved_at: null });
  }

  const client = await db.getClientByUserId(user.id);
  const admins = await db.listAdminUsers();
  const adminNotificationTitle = `ลูกค้าตอบกลับ Ticket: ${ticket.title}`;
  await Promise.all(
    admins.map((admin) =>
      db.createNotification({
        id: generateId(),
        user_id: admin.id,
        type: "ticket_reply_from_client",
        title: adminNotificationTitle,
        body: parsed.data.message.slice(0, 120),
        link: `/admin/tickets/${ticket.id}`,
        read: 0,
      })
    )
  );

  // Email the team at most once per ticket per 30 minutes; follow-ups roll up.
  const [firstAdmin, ...otherAdmins] = admins.filter((a) => a.email);
  if (firstAdmin && env.SEND_EMAIL) {
    const ticketUrl = `${env.APP_URL}/admin/tickets/${ticket.id}`;
    await sendOrHoldTicketEmail(
      env,
      ticket.id,
      {
        to: firstAdmin.email,
        toName: firstAdmin.name,
        cc: otherAdmins.map((a) => ({ email: a.email })),
        ticketTitle: ticket.title,
        ticketUrl,
        lang: "th",
        audience: "team",
        lastMessage: parsed.data.message,
      },
      async () => {
        for (const admin of [firstAdmin, ...otherAdmins]) {
          await sendTicketEmailToAdmin({
            to: admin.email,
            toName: admin.name,
            clientName: client?.company_name ?? user.name,
            ticketTitle: ticket.title,
            message: parsed.data.message,
            ticketUrl,
            sendEmail: env.SEND_EMAIL,
            db,
          });
        }
      },
      // Urgent tickets reach the team on every message, never rolled up.
      { urgent: ticket.priority === "urgent" }
    );
  }
  await sendTelegramNotification({
    db,
    appUrl: env.APP_URL,
    notification: {
      title: adminNotificationTitle,
      body: parsed.data.message.slice(0, 120),
      link: `/admin/tickets/${ticket.id}`,
    },
  });

  return redirect(`/tickets/${ticket.id}`);
}

export default function TicketDetailPage({ loaderData, actionData }: any) {
  const { ticket, messages, attachments, usersById, currentUserId } = loaderData as LoaderData;
  const errors = actionData?.errors;
  const { t, lang } = useT();
  const navigation = useNavigation();
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

  const allLightboxItems: LightboxItem[] = attachments.map((att) => ({
    id: att.id,
    name: att.file_name,
    href: `/api/attachments/${encodeURIComponent(att.file_key)}`,
    icon: getAttachmentIcon(att.file_name, att.mime_type),
  }));

  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const openLightbox = (attachmentId: string) => {
    const idx = allLightboxItems.findIndex(i => i.id === attachmentId);
    if (idx >= 0) setLightboxIndex(idx);
  };

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
          throw new Error("รองรับเฉพาะ PDF, รูปภาพ, วิดีโอ");
        }
        const prepared = await prepareAttachmentForUpload(rawFile);
        if (isAttachmentTooLarge(prepared)) {
          throw new Error("ไฟล์ต้องมีขนาดไม่เกิน 2MB");
        }
        const uploaded = await uploadAttachment({
          ticketId: ticket.id,
          file: prepared,
          onProgress: (percent) => setUploadProgress(percent),
        });
        setUploadedFiles((prev) => [...prev, uploaded]);
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "อัปโหลดไฟล์ไม่สำเร็จ");
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {lightboxIndex !== null && allLightboxItems.length > 0 && (
        <AttachmentLightbox
          items={allLightboxItems}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
      <Link to="/tickets" className="text-sm text-muted-ink hover:text-ink mb-4 inline-block">
        {t("back")}
      </Link>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium text-faint-ink">#{ticket.id}</p>
          <h1 className="text-[26px] md:text-[32px] font-bold leading-tight tracking-[-0.02em] text-ink">{ticket.title}</h1>
          <p className="mt-1 text-sm text-muted-ink">
            {t("ticket_created_at")} {formatDate(ticket.created_at, lang)}
          </p>
        </div>
      </div>

      <div className="space-y-4 rounded-[20px] border border-line bg-white p-4 md:p-5">
        <StatusStepper status={ticket.status} lang={lang} />
      <div className="grid grid-cols-2 gap-4 border-t border-line-soft pt-4 sm:grid-cols-3">
        <div>
          <p className="text-xs text-muted-ink">{t("ticket_status_label")}</p>
          <div className="mt-1">
            <StatusBadge status={ticket.status} />
          </div>
        </div>
        <div>
          <p className="text-xs text-muted-ink">{t("ticket_priority_label")}</p>
          <div className="mt-1">
            <PriorityBadge priority={ticket.priority} />
          </div>
        </div>
        <div>
          <p className="text-xs text-muted-ink">{t("ticket_opened_at")}</p>
          <p className="mt-1 text-sm font-medium text-ink">
            {formatDate(ticket.created_at, lang)}
          </p>
        </div>
      </div>
      </div>

      {/* Chat layout: the thread scrolls inside the card, newest at the bottom,
          with the reply box always directly underneath. */}
      <div className="flex flex-col overflow-hidden rounded-[20px] border border-line bg-white md:sticky md:top-4 md:h-[calc(100dvh-8rem)] md:min-h-[480px]">
      <ChatThread
        className="max-h-[60dvh] min-h-[240px] bg-paper/60 md:max-h-none md:min-h-0 md:flex-1"
        showEarlierLabel={(n) => (lang === "en" ? `Show ${n} earlier messages` : `แสดงข้อความก่อนหน้า (${n})`)}
        first={<MessageBubble message={ticket.description} isClient={true} isInternal={false} alignRight={true} />}
        items={messages
          .filter((msg) => msg.is_internal === 0)
          .map((msg) => ({ key: msg.id, node: (
            <MessageBubble
              message={msg.message}
              isClient={usersById[msg.user_id]?.role !== "admin"}
              alignRight={usersById[msg.user_id]?.role !== "admin"}
              isInternal={msg.is_internal === 1}
              authorName={usersById[msg.user_id]?.name}
              attachments={(attachmentsByMessage[msg.id] ?? []).map((att) => ({
                id: att.id,
                name: att.file_name,
                href: `/api/attachments/${encodeURIComponent(att.file_key)}`,
                icon: getAttachmentIcon(att.file_name, att.mime_type),
              }))}
              onAttachmentClick={(a) => openLightbox(a.id)}
            />
          ) }))}
      />

      <div key={messages.length} className="shrink-0 border-t border-line-soft bg-white p-4 md:max-h-[50%] md:overflow-y-auto md:px-5">
        <Form method="post" className="space-y-3">
          <input type="hidden" name="attachments_json" value={JSON.stringify(uploadedFiles)} />
          <label className="block text-sm font-medium text-slate-700">
            {t("ticket_reply_label")}
          </label>
          <textarea
            name="message"
            rows={2}
            required
            placeholder={t("ticket_ph_reply")}
            className="w-full rounded-[14px] border border-line bg-white px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ink/10 focus:border-ink/40"
          />
          {errors?.message ? (
            <p className="text-xs text-rose-600">{errors.message[0]}</p>
          ) : null}
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
                    className="h-full bg-slate-900 transition-all"
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
                      {getAttachmentIcon(f.fileName, f.mimeType)} {f.fileName}
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
          <div className="flex justify-end">
            <button
              type="submit"
              className="h-11 w-full sm:h-10 sm:w-auto rounded-full bg-ink px-5 text-[13px] font-semibold text-white hover:bg-black"
            >
              {t("btn_send_message")}
            </button>
          </div>
        </Form>
      </div>
      </div>
    </div>
  );
}
