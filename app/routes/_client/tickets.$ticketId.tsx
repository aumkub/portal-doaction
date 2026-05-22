import { Form, Link, redirect, useNavigation } from "react-router";
import { useEffect, useRef } from "react";
import { z } from "zod";
import { requireUser } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";
import { formatDate, generateId } from "~/lib/utils";
import { sendTelegramNotification } from "~/lib/telegram.server";
import { sendTicketEmailToAdmin } from "~/lib/ticket-email.server";
import { useTicketAttachments } from "~/hooks/use-ticket-attachments";
import { useT } from "~/lib/i18n";
import type { SupportTicket, TicketAttachment, TicketMessage, User } from "~/types";
import StatusBadge from "~/components/tickets/StatusBadge";
import PriorityBadge from "~/components/tickets/PriorityBadge";
import MessageBubble from "~/components/tickets/MessageBubble";
import { TicketReplyDropZone } from "~/components/tickets/TicketReplyDropZone";
import { FaPaperclip, FaCircleCheck, FaCircleXmark, FaXmark } from "react-icons/fa6";

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
  const intent = formData.get("intent");

  // ── Status change ─────────────────────────────────────────────
  if (intent === "status") {
    const client = await db.getClientByUserId(user.id);
    if (!client || client.id !== ticket.client_id) {
      throw new Response("Forbidden", { status: 403 });
    }
    const status = formData.get("status") as string;
    if (status === "resolved" || status === "closed" || status === "in_progress") {
      const updateData: any = { status };
      if (status === "resolved") updateData.resolved_at = Math.floor(Date.now() / 1000);
      if (status === "in_progress") updateData.resolved_at = null;
      await db.updateTicket(ticket.id, updateData);
    }
    return redirect(`/tickets/${ticket.id}`);
  }

  // ── Delete ticket ──────────────────────────────────────────────
  if (intent === "delete") {
    if (user.role === "client") {
      const client = await db.getClientByUserId(user.id);
      if (!client || client.id !== ticket.client_id) {
        throw new Response("Forbidden", { status: 403 });
      }
    }
    // Only allow deletion while ticket is still open (no admin interaction yet)
    if (ticket.status !== "open") {
      return { errors: { message: ["ไม่สามารถลบ Ticket ที่อยู่ระหว่างดำเนินการหรือปิดแล้วได้"] } };
    }
    await db.softDeleteTicket(ticket.id, user.id);
    return redirect("/tickets");
  }

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
  const {
    uploading,
    uploadProgress,
    uploadError,
    uploadedFiles,
    attachmentsJson,
    onFileInputChange,
    onPaste,
    removeFile,
    markSubmitSuccess,
    isDragging,
    dropZoneProps,
  } = useTicketAttachments({
    ticketId: ticket.id,
    invalidTypeMessage: "รองรับเฉพาะ PDF, รูปภาพ, วิดีโอ",
    tooLargeMessage: "ไฟล์ต้องมีขนาดไม่เกิน 2MB",
    uploadFailedMessage: "อัปโหลดไฟล์ไม่สำเร็จ",
  });
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
    markSubmitSuccess();
    isSubmittingReplyRef.current = false;
  }, [navigation.state, errors?.message, markSubmitSuccess]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link to="/tickets" className="text-sm text-slate-500 hover:text-slate-900 mb-4 inline-block">
        {t("back")}
      </Link>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-slate-500">#{ticket.id}</p>
          <h1 className="text-2xl font-semibold text-slate-900">{ticket.title}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {t("ticket_created_at")} {formatDate(ticket.created_at, lang)}
          </p>
        </div>
        {ticket.status === "open" && (
          <Form
            method="post"
            onSubmit={(e) => {
              if (!confirm("ต้องการลบ Ticket นี้ใช่หรือไม่? การลบไม่สามารถยกเลิกได้")) {
                e.preventDefault();
              }
            }}
          >
            <input type="hidden" name="intent" value="delete" />
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-100 hover:border-red-300 transition-colors"
            >
              ลบ Ticket
            </button>
          </Form>
        )}
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

      {ticket.status === "resolved" ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <div className="flex items-start gap-3">
            <FaCircleCheck className="text-emerald-500 text-lg mt-0.5 shrink-0" aria-hidden="true" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-emerald-900">ทีมงานแจ้งว่าได้แก้ปัญหาเรียบร้อยแล้ว</p>
              <p className="text-xs text-emerald-700 mt-0.5">กรุณายืนยันว่าปัญหาได้รับการแก้ไขแล้ว หรือแจ้งว่ายังไม่เรียบร้อย</p>
              <div className="flex flex-wrap gap-2 mt-3">
                <Form method="post">
                  <input type="hidden" name="intent" value="status" />
                  <input type="hidden" name="status" value="closed" />
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 transition-colors disabled:opacity-60"
                  >
                    <FaCircleCheck className="text-[10px]" />
                    ยืนยัน แก้ปัญหาแล้ว
                  </button>
                </Form>
                <Form method="post">
                  <input type="hidden" name="intent" value="status" />
                  <input type="hidden" name="status" value="in_progress" />
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-white px-4 py-2 text-xs font-medium text-emerald-800 hover:bg-emerald-50 transition-colors disabled:opacity-60"
                  >
                    <FaCircleXmark className="text-[10px]" />
                    ยังไม่เรียบร้อย
                  </button>
                </Form>
              </div>
            </div>
          </div>
        </div>
      ) : ["open", "in_progress", "waiting"].includes(ticket.status) ? (
        <div className="rounded-xl border border-slate-200 bg-white p-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-slate-700">ต้องการปิด Ticket นี้?</p>
            <p className="text-xs text-slate-500 mt-0.5">ใช้เมื่อปัญหาได้รับการแก้ไขแล้ว หรือไม่ต้องการความช่วยเหลือเพิ่มเติม</p>
          </div>
          <div className="flex gap-2 shrink-0">
            <Form method="post">
              <input type="hidden" name="intent" value="status" />
              <input type="hidden" name="status" value="resolved" />
              <button
                type="submit"
                disabled={isSubmitting}
                className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700 hover:bg-emerald-100 transition-colors disabled:opacity-60"
              >
                <FaCircleCheck className="text-[10px]" />
                {t("status_resolved")}
              </button>
            </Form>
            <Form method="post">
              <input type="hidden" name="intent" value="status" />
              <input type="hidden" name="status" value="closed" />
              <button
                type="submit"
                disabled={isSubmitting}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-60"
              >
                <FaXmark className="text-[10px]" />
                {t("status_closed_short")}
              </button>
            </Form>
          </div>
        </div>
      ) : null}

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
                mimeType: att.mime_type,
                sizeBytes: att.size_bytes,
              }))}
            />
          ))}
      </div>

      <div key={messages.length} className="rounded-2xl border border-slate-200 bg-white p-4">
        <TicketReplyDropZone
          isDragging={isDragging}
          dropHandlers={dropZoneProps}
          dropLabel={t("ticket_drop_files")}
          className={isDragging ? "ring-2 ring-violet-400/50 ring-offset-2 rounded-xl" : ""}
        >
        <Form method="post" className="space-y-3">
          <input type="hidden" name="attachments_json" value={attachmentsJson} />
          <label className="block text-sm font-medium text-slate-700">
            {t("ticket_reply_label")}
          </label>
          <textarea
            name="message"
            rows={4}
            required
            placeholder={t("ticket_ph_reply")}
            onPaste={onPaste}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
          />
          {errors?.message ? (
            <p className="text-xs text-rose-600">{errors.message[0]}</p>
          ) : null}
          <div className="space-y-1">
            <label className="block text-xs font-medium text-slate-600">
              {t("ticket_attach_hint")}
            </label>
            <input
              type="file"
              accept="application/pdf,image/*,video/*"
              multiple
              onChange={(e) => onFileInputChange(e.target.files)}
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
            {uploadError ? (
              <p className="text-xs text-rose-600">{uploadError}</p>
            ) : null}
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
                      onClick={() => removeFile(f.fileKey)}
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
        </TicketReplyDropZone>
      </div>
    </div>
  );
}
