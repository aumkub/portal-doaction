import { Form, Link, redirect, useNavigation } from "react-router";
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
import PriorityBadge from "~/components/tickets/PriorityBadge";
import MessageBubble from "~/components/tickets/MessageBubble";
import { FaPaperclip } from "react-icons/fa6";

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

export async function loader({ request, context, params }: any) {
  const user = await requireUser(
    request,
    context.cloudflare.env.DB,
    context.cloudflare.env.SESSIONPORTAL
  );
  const db = createDB(context.cloudflare.env.DB);
  const ticket = await db.getTicket(params.ticketId);
  if (!ticket) throw new Response("Ticket not found", { status: 404 });

  if (user.role === "client") {
    const client = await db.getClientByUserId(user.id);
    if (!client || client.id !== ticket.client_id) {
      throw new Response("Forbidden", { status: 403 });
    }
  }

  const [messages, attachments, admins] = await Promise.all([
    db.listMessagesByTicket(ticket.id),
    db.listAttachmentsByTicket(ticket.id),
    db.listAdminUsers(),
  ]);

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
  const ticket = await db.getTicket(params.ticketId);
  if (!ticket) throw new Response("Ticket not found", { status: 404 });

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
        if (!item?.fileKey) continue;
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
  const ticketUrl = `${env.APP_URL}/admin/tickets/${ticket.id}`;

  // DB writes are fast — do them synchronously
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

  // Email + Telegram are HTTP calls — fire in background, don't block the redirect
  const msgSnapshot = parsed.data.message;
  context.cloudflare.ctx.waitUntil(
    Promise.allSettled([
      sendTelegramNotification({
        db,
        appUrl: env.APP_URL,
        notification: {
          title: adminNotificationTitle,
          body: msgSnapshot.slice(0, 120),
          link: `/admin/tickets/${ticket.id}`,
        },
      }),
      ...admins.map((admin) =>
        env.SEND_EMAIL
          ? sendTicketEmailToAdmin({
              to: admin.email,
              toName: admin.name,
              clientName: client?.company_name ?? user.name,
              ticketTitle: ticket.title,
              message: msgSnapshot,
              ticketUrl,
              sendEmail: env.SEND_EMAIL,
              db,
            })
          : Promise.resolve()
      ),
    ])
  );

  return redirect(`/tickets/${ticket.id}`);
}

export default function TicketDetailPage({ loaderData, actionData }: any) {
  const { ticket, messages, attachments, usersById, currentUserId } = loaderData as LoaderData;
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
      <Link to="/tickets" className="text-sm text-slate-500 hover:text-slate-900 mb-4 inline-block">
        {t("back")}
      </Link>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium text-slate-400">#{ticket.id}</p>
          <h1 className="text-2xl font-semibold text-slate-900">{ticket.title}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {t("ticket_created_at")} {formatDate(ticket.created_at, lang)}
          </p>
        </div>
      </div>

      <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-3">
        <div>
          <p className="text-xs text-slate-500">{t("ticket_status_label")}</p>
          <div className="mt-1">
            <StatusBadge status={ticket.status} />
          </div>
        </div>
        <div>
          <p className="text-xs text-slate-500">{t("ticket_priority_label")}</p>
          <div className="mt-1">
            <PriorityBadge priority={ticket.priority} />
          </div>
        </div>
        <div>
          <p className="text-xs text-slate-500">{t("ticket_opened_at")}</p>
          <p className="mt-1 text-sm font-medium text-slate-700">
            {formatDate(ticket.created_at, lang)}
          </p>
        </div>
      </div>

      <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <MessageBubble message={ticket.description} isClient={true} isInternal={false} alignRight={true} />
        {messages
          .filter((msg) => msg.is_internal === 0)
          .map((msg) => (
            <MessageBubble
              key={msg.id}
              message={msg.message}
              isClient={usersById[msg.user_id]?.role !== "admin"}
              alignRight={usersById[msg.user_id]?.role !== "admin"}
              isInternal={msg.is_internal === 1}
              authorName={usersById[msg.user_id]?.name}
              attachments={(attachmentsByMessage[msg.id] ?? []).map((att) => ({
                id: att.id,
                name: att.file_name,
                href: `/api/attachments/${encodeURIComponent(att.file_key)}`,
              }))}
            />
          ))}
      </div>

      <div key={messages.length} className="rounded-2xl border border-slate-200 bg-white p-4">
        <Form method="post" className="space-y-3">
          <input type="hidden" name="attachments_json" value={JSON.stringify(uploadedFiles)} />
          <label className="block text-sm font-medium text-slate-700">
            {t("ticket_reply_label")}
          </label>
          <textarea
            name="message"
            rows={4}
            required
            placeholder={t("ticket_ph_reply")}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
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
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={uploading || isSubmitting}
              className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700"
            >
              {uploading ? "Uploading..." : isSubmitting ? "Sending..." : t("btn_send_message")}
            </button>
          </div>
        </Form>
      </div>
    </div>
  );
}
