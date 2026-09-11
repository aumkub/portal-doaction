import { Form, redirect, useFetcher, useFetchers } from "react-router";
import { useEffect } from "react";
import { z } from "zod";
import { FaTrashCan } from "react-icons/fa6";
import { requireCoAdminOrAdmin } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";
import { formatDate, generateId } from "~/lib/utils";
import { sendTelegramNotificationForClient } from "~/lib/telegram.server";
import {
  sendTicketClosedEmailToClient,
  sendTicketEmailToClient,
} from "~/lib/ticket-email.server";
import {
  TicketReplyComposer,
  pendingReplyAttachments,
  replyFetcherKey,
} from "~/components/tickets/TicketReplyComposer";
import type {
  SupportTicket,
  TicketAttachment,
  TicketMessage,
  MessageAuthor,
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
  note_visibility: z.enum(["external", "internal"]).optional(),
  intent: z.enum(["reply", "status", "delete_message"]).default("reply"),
  status: z.string().optional(),
  message_id: z.string().optional(),
});

export function meta({ data }: any) {
  const ticket = data?.ticket as SupportTicket | undefined;
  return [{ title: ticket ? `Ticket: ${ticket.title} — Admin` : "Ticket — Admin" }];
}

export async function loader({ request, context, params }: any) {
  const env = context.cloudflare.env;
  const admin = await requireCoAdminOrAdmin(request, env.DB, env.SESSIONPORTAL);
  const db = createDB(env.DB);

  const ticket = await db.getTicket(params.ticketId);
  if (!ticket) throw new Response("Ticket not found", { status: 404 });
  await assertCanAccessTicket(db, admin, ticket.client_id);

  const [messages, attachments, authors, client] = await Promise.all([
    db.listMessagesByTicket(ticket.id),
    db.listAttachmentsByTicket(ticket.id),
    db.listMessageAuthors(ticket.id),
    db.getClientById(ticket.client_id),
  ]);

  const usersById: Record<string, MessageAuthor> = {};
  for (const a of authors) usersById[a.id] = a;

  return { ticket, messages, attachments, usersById, client, admin };
}

const STATUSES = [
  "open",
  "in_progress",
  "waiting",
  "resolved",
  "closed",
] as const;

async function assertCanAccessTicket(
  db: ReturnType<typeof createDB>,
  user: User,
  clientId: string
) {
  if (user.role !== "co-admin") return;
  const assignments = await db.listCoAdminClients(user.id);
  if (!assignments.some((a) => a.client_id === clientId)) {
    throw new Response("Forbidden", { status: 403 });
  }
}

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
  const admin = await requireCoAdminOrAdmin(request, env.DB, env.SESSIONPORTAL);
  const db = createDB(env.DB);

  const ticket = await db.getTicket(params.ticketId);
  if (!ticket) throw new Response("Ticket not found", { status: 404 });
  await assertCanAccessTicket(db, admin, ticket.client_id);

  const formData = await request.formData();
  const raw = Object.fromEntries(formData);
  const parsed = ReplySchema.safeParse(raw);
  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const { intent, message, is_internal, note_visibility, status, message_id } = parsed.data;

  if (intent === "delete_message") {
    const target = message_id ? await db.getTicketMessage(message_id) : null;
    // Scoped to this ticket so the ticket-level access check above covers it.
    if (!target || target.ticket_id !== ticket.id) {
      return { error: "ไม่พบข้อความ" };
    }
    if (admin.role !== "admin" && target.user_id !== admin.id) {
      throw new Response("Forbidden", { status: 403 });
    }
    const fileKeys = await db.deleteTicketMessage(target.id);
    if (fileKeys.length > 0) {
      context.cloudflare.ctx.waitUntil(
        Promise.allSettled(fileKeys.map((key) => env.ATTACHMENTS.delete(key)))
      );
    }
    return { ok: true };
  }

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
      // Telegram and email are external HTTP calls; awaiting them held the
      // response until both providers answered.
      context.cloudflare.ctx.waitUntil(
        Promise.allSettled([
          sendTelegramNotificationForClient({
            db,
            appUrl: env.APP_URL,
            notification,
            clientId: client.id,
          }),
          status === "closed" && clientUser?.email && env.SMTP2GO_API_KEY
            ? sendTicketClosedEmailToClient({
                to: clientUser.email,
                toName: clientUser.name,
                ticketTitle: ticket.title,
                ticketUrl: `${env.APP_URL}/tickets/${ticket.id}`,
                apiKey: env.SMTP2GO_API_KEY,
                db,
              })
            : Promise.resolve(),
        ])
      );
    }
    return redirect(`/admin/tickets/${ticket.id}`);
  }

  // Reply
  const isInternal = note_visibility === "internal" || is_internal === "1" ? 1 : 0;
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
      await Promise.all(
        items
          .filter((item) => item?.fileKey)
          .map((item) =>
            db.createTicketAttachment({
              id: generateId(),
              ticket_id: ticket.id,
              message_id: messageId,
              uploader_user_id: admin.id,
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

  if (!isInternal) {
    const [client] = await Promise.all([
      db.getClientById(ticket.client_id),
      ticket.status === "open"
        ? db.updateTicket(ticket.id, { status: "in_progress" })
        : Promise.resolve(),
    ]);
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
      context.cloudflare.ctx.waitUntil(
        Promise.allSettled([
          sendTelegramNotificationForClient({
            db,
            appUrl: env.APP_URL,
            notification,
            clientId: client.id,
          }),
          clientUser?.email && env.SMTP2GO_API_KEY
            ? sendTicketEmailToClient({
                to: clientUser.email,
                toName: clientUser.name,
                ticketTitle: ticket.title,
                message,
                ticketUrl: `${env.APP_URL}/tickets/${ticket.id}`,
                apiKey: env.SMTP2GO_API_KEY,
                db,
              })
            : Promise.resolve(),
        ])
      );
    }
  }

  // Submitted through a fetcher, which revalidates the loaders on its own.
  return { ok: true };
}

function DeleteMessageButton({ messageId }: { messageId: string }) {
  const fetcher = useFetcher<{ ok?: boolean; error?: string }>();

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.error) alert(fetcher.data.error);
  }, [fetcher.state, fetcher.data]);

  return (
    <fetcher.Form
      method="post"
      onSubmit={(e) => {
        if (!confirm("ลบข้อความนี้ใช่หรือไม่? ไฟล์แนบของข้อความจะถูกลบด้วย")) e.preventDefault();
      }}
    >
      <input type="hidden" name="intent" value="delete_message" />
      <input type="hidden" name="message_id" value={messageId} />
      <button
        type="submit"
        disabled={fetcher.state !== "idle"}
        aria-label="ลบข้อความ"
        title="ลบข้อความ"
        className="rounded p-1 opacity-60 transition-opacity hover:opacity-100 focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-60"
      >
        <FaTrashCan className="h-3 w-3" aria-hidden="true" />
      </button>
    </fetcher.Form>
  );
}

export default function AdminTicketDetailPage({ loaderData }: any) {
  const { ticket, messages, attachments, usersById, client, admin } = loaderData as {
    ticket: SupportTicket;
    messages: TicketMessage[];
    attachments: TicketAttachment[];
    usersById: Record<string, MessageAuthor>;
    client: Client | null;
    admin: User;
  };
  const { t, lang } = useT();

  const replyFetcher = useFetcher({ key: replyFetcherKey(ticket.id) });
  const pendingReply = replyFetcher.state !== "idle" ? replyFetcher.formData : undefined;
  const pendingInternal = pendingReply?.get("note_visibility") === "internal";

  // Hide a message as soon as its delete is submitted; it reappears on its own
  // if the server rejects it, because the loader still returns it.
  const deletingIds = new Set(
    useFetchers()
      .filter((f) => f.formData?.get("intent") === "delete_message")
      .map((f) => String(f.formData?.get("message_id")))
  );
  const visibleMessages = messages.filter((m) => !deletingIds.has(m.id));
  const externalMessages = visibleMessages.filter((m) => m.is_internal === 0);
  const internalMessages = visibleMessages.filter((m) => m.is_internal === 1);

  const attachmentsByMessage = attachments.reduce<Record<string, TicketAttachment[]>>(
    (acc, a) => {
      (acc[a.message_id] ||= []).push(a);
      return acc;
    },
    {}
  );

  const renderMessage = (msg: TicketMessage, isInternal: boolean) => {
    const author = usersById[msg.user_id];
    const isStaff = author?.role === "admin" || author?.role === "co-admin";
    const canDelete = admin.role === "admin" || msg.user_id === admin.id;
    return (
      <div key={msg.id} id={`msg-${msg.id}`}>
        <MessageBubble
          message={msg.message}
          isClient={isInternal ? false : isStaff}
          isInternal={isInternal}
          authorName={author?.name}
          authorBadge={author?.role === "co-admin" ? "Co-Admin" : undefined}
          actions={canDelete ? <DeleteMessageButton messageId={msg.id} /> : undefined}
          attachments={(attachmentsByMessage[msg.id] ?? []).map((att) => ({
            id: att.id,
            name: att.file_name,
            href: `/api/attachments/${encodeURIComponent(att.file_key)}`,
            icon: getAttachmentIcon(att.file_name, att.mime_type),
            mimeType: att.mime_type,
          }))}
        />
      </div>
    );
  };

  const pendingBubble = pendingReply ? (
    <MessageBubble
      pending
      message={String(pendingReply.get("message") ?? "")}
      isClient={!pendingInternal}
      isInternal={pendingInternal}
      authorName={admin.name}
      authorBadge={admin.role === "co-admin" ? "Co-Admin" : undefined}
      attachments={pendingReplyAttachments(pendingReply)}
    />
  ) : null;

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

      {/* External conversation */}
      <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1.5 mb-1">
          <span>💬</span> บทสนทนา — ลูกค้าเห็น
        </p>
        <MessageBubble message={ticket.description} isClient={false} isInternal={false} />
        {externalMessages.map((msg) => renderMessage(msg, false))}
        {!pendingInternal ? pendingBubble : null}
        {externalMessages.length === 0 && !(pendingReply && !pendingInternal) && (
          <p className="text-xs text-slate-400 text-center py-2">ยังไม่มีข้อความ</p>
        )}
      </div>

      {/* Internal notes */}
      {(internalMessages.length > 0 || (pendingReply && pendingInternal)) && (
        <div className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50/40 p-4">
          <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide flex items-center gap-1.5 mb-1">
            <span>🔒</span> บันทึกภายใน — ทีมเท่านั้น
          </p>
          {internalMessages.map((msg) => renderMessage(msg, true))}
          {pendingInternal ? pendingBubble : null}
        </div>
      )}

      {/* Reply form */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <TicketReplyComposer
          ticketId={ticket.id}
          hiddenFields={{ intent: "reply" }}
          label={t("admin_ticket_reply_label")}
          placeholder={t("admin_ticket_ph_reply")}
          attachHint="แนบไฟล์ (PDF/รูป/วิดีโอ ไม่เกิน 2MB) — วางรูปด้วย Cmd/Ctrl+V หรือลากไฟล์มาวางได้"
          dropLabel={t("ticket_drop_files")}
          sendLabel={t("admin_ticket_send")}
          sendingLabel="กำลังส่ง…"
          extraControls={
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <span className="shrink-0">{t("admin_ticket_note_visibility")}</span>
              <select
                name="note_visibility"
                defaultValue="external"
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-violet-500"
              >
                <option value="external">{t("admin_ticket_external_note")}</option>
                <option value="internal">{t("admin_ticket_internal_note")}</option>
              </select>
            </label>
          }
        />
      </div>
    </div>
  );
}
