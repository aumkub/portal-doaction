import { Form, Link, redirect, useFetcher, useNavigation } from "react-router";
import { z } from "zod";
import { requireUser } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";
import { formatDate, generateId } from "~/lib/utils";
import { sendTelegramNotificationForClient } from "~/lib/telegram.server";
import { sendTicketEmailToAdmin } from "~/lib/ticket-email.server";
import { useT } from "~/lib/i18n";
import type { MessageAuthor, SupportTicket, TicketAttachment, TicketMessage } from "~/types";
import StatusBadge from "~/components/tickets/StatusBadge";
import PriorityBadge from "~/components/tickets/PriorityBadge";
import MessageBubble from "~/components/tickets/MessageBubble";
import {
  TicketReplyComposer,
  pendingReplyAttachments,
  replyFetcherKey,
} from "~/components/tickets/TicketReplyComposer";
import { FaCircleCheck, FaCircleXmark, FaXmark } from "react-icons/fa6";

const ReplySchema = z.object({
  message: z.string().min(1, "กรุณาพิมพ์ข้อความ"),
});

type LoaderData = {
  ticket: SupportTicket;
  messages: TicketMessage[];
  attachments: TicketAttachment[];
  usersById: Record<string, MessageAuthor>;
  currentUser: MessageAuthor;
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

  const [allMessages, allAttachments, authors] = await Promise.all([
    db.listMessagesByTicket(ticket.id),
    db.listAttachmentsByTicket(ticket.id),
    db.listMessageAuthors(ticket.id),
  ]);

  // Loader data is serialized into the page, so internal notes and their files
  // must be dropped here — hiding them at render time still ships them.
  const messages = allMessages.filter((m) => m.is_internal === 0);
  const visibleIds = new Set(messages.map((m) => m.id));
  const attachments = allAttachments.filter((a) => visibleIds.has(a.message_id));
  const visibleAuthorIds = new Set(messages.map((m) => m.user_id));

  const currentUser: MessageAuthor = {
    id: user.id,
    name: user.name,
    role: user.role,
    avatar_url: user.avatar_url,
  };
  const usersById: Record<string, MessageAuthor> = {};
  for (const a of authors) if (visibleAuthorIds.has(a.id)) usersById[a.id] = a;
  usersById[user.id] = currentUser;

  return { ticket, messages, attachments, usersById, currentUser };
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

  // The loader enforces this, but the action is reachable on its own.
  const client = await db.getClientByUserId(user.id);
  if (user.role === "client" && (!client || client.id !== ticket.client_id)) {
    throw new Response("Forbidden", { status: 403 });
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
      await Promise.all(
        items
          .filter((item) => item?.fileKey)
          .map((item) =>
            db.createTicketAttachment({
              id: generateId(),
              ticket_id: ticket.id,
              message_id: messageId,
              uploader_user_id: user.id,
              file_key: item.fileKey,
              file_name: item.fileName || "attachment",
              mime_type: item.mimeType || "application/octet-stream",
              size_bytes: Number(item.sizeBytes) || 0,
            })
          )
      );
    } catch {
      // ignore malformed attachment payload
    }
  }

  const [admins] = await Promise.all([
    db.listAdminUsers(),
    ticket.status === "resolved" || ticket.status === "closed"
      ? db.updateTicket(ticket.id, { status: "in_progress", resolved_at: null })
      : Promise.resolve(),
  ]);
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
      sendTelegramNotificationForClient({
        db,
        appUrl: env.APP_URL,
        notification: {
          title: adminNotificationTitle,
          body: msgSnapshot.slice(0, 120),
          link: `/admin/tickets/${ticket.id}`,
        },
        clientId: ticket.client_id,
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

  // Submitted through a fetcher, which revalidates the loaders on its own.
  return { ok: true };
}

export default function TicketDetailPage({ loaderData, actionData }: any) {
  const { ticket, messages, attachments, usersById, currentUser } = loaderData as LoaderData;
  const errors = actionData?.errors;
  const { t, lang } = useT();
  const navigation = useNavigation();
  const isSubmitting = navigation.state !== "idle";
  const replyFetcher = useFetcher({ key: replyFetcherKey(ticket.id) });
  const pendingReply = replyFetcher.state !== "idle" ? replyFetcher.formData : undefined;
  const attachmentsByMessage = attachments.reduce<Record<string, TicketAttachment[]>>(
    (acc, a) => {
      (acc[a.message_id] ||= []).push(a);
      return acc;
    },
    {}
  );

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
      {errors?.message ? (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {errors.message[0]}
        </p>
      ) : null}

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
          .map((msg) => {
            const role = usersById[msg.user_id]?.role;
            const fromCustomer = role !== "admin" && role !== "co-admin";
            return (
              <MessageBubble
                key={msg.id}
                message={msg.message}
                isClient={fromCustomer}
                alignRight={fromCustomer}
                isInternal={msg.is_internal === 1}
                authorName={usersById[msg.user_id]?.name}
                attachments={(attachmentsByMessage[msg.id] ?? []).map((att) => ({
                  id: att.id,
                  name: att.file_name,
                  href: `/api/attachments/${encodeURIComponent(att.file_key)}`,
                  mimeType: att.mime_type,
                }))}
              />
            );
          })}
        {pendingReply ? (
          <MessageBubble
            pending
            message={String(pendingReply.get("message") ?? "")}
            isClient={true}
            alignRight={true}
            isInternal={false}
            authorName={currentUser.name}
            attachments={pendingReplyAttachments(pendingReply)}
          />
        ) : null}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <TicketReplyComposer
          ticketId={ticket.id}
          label={t("ticket_reply_label")}
          placeholder={t("ticket_ph_reply")}
          attachHint={t("ticket_attach_hint")}
          dropLabel={t("ticket_drop_files")}
          sendLabel={t("btn_send_message")}
          sendingLabel="กำลังส่ง…"
          invalidTypeMessage="รองรับเฉพาะ PDF, รูปภาพ, วิดีโอ"
          tooLargeMessage="ไฟล์ต้องมีขนาดไม่เกิน 2MB"
          uploadFailedMessage="อัปโหลดไฟล์ไม่สำเร็จ"
        />
      </div>
    </div>
  );
}
