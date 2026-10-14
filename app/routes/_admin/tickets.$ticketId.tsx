import { Form, redirect, useNavigation } from "react-router";
import { ChatThread } from "~/components/tickets/ChatThread";
import { parseClientCcEmails } from "~/lib/client-cc";
import { sendOrHoldTicketEmail } from "~/lib/email-alerts.server";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { requireAdmin } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";
import { formatDate, formatRelativeTime, generateId } from "~/lib/utils";
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
import AttachmentLightbox from "~/components/tickets/AttachmentLightbox";
import type { LightboxItem } from "~/components/tickets/AttachmentLightbox";
import { StatusStepper } from "~/components/tickets/StatusStepper";
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

      if (status === "closed" && clientUser?.email && env.SEND_EMAIL) {
        const ticketUrl = `${env.APP_URL}/tickets/${ticket.id}`;
        await sendTicketClosedEmailToClient({
          to: clientUser.email,
          toName: clientUser.name,
          cc: parseClientCcEmails(client.cc_emails).map((email) => ({ email })),
          ticketTitle: ticket.title,
          ticketUrl,
          sendEmail: env.SEND_EMAIL,
          db,
          lang: clientUser.language === "en" ? "en" : "th",
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
      if (clientUser?.email && env.SEND_EMAIL) {
        const ticketUrl = `${env.APP_URL}/tickets/${ticket.id}`;
        const cc = parseClientCcEmails(client.cc_emails).map((email) => ({ email }));
        const lang = clientUser.language === "en" ? "en" : "th";
        // Several quick replies become one email (the rest roll up via cron).
        await sendOrHoldTicketEmail(
          env,
          ticket.id,
          { to: clientUser.email, toName: clientUser.name, cc, ticketTitle: ticket.title, ticketUrl, lang, audience: "client", lastMessage: message },
          () =>
            sendTicketEmailToClient({
              to: clientUser.email,
              toName: clientUser.name,
              cc,
              ticketTitle: ticket.title,
              message,
              ticketUrl,
              sendEmail: env.SEND_EMAIL,
              db,
              lang,
            })
        );
      }
    }
  }

  return redirect(`/admin/tickets/${ticket.id}`);
}

export default function AdminTicketDetailPage({ loaderData, actionData }: any) {
  const { ticket, messages, attachments, usersById, client, admin } = loaderData as {
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
  const [composeMode, setComposeMode] = useState<"reply" | "internal">("reply");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const insertQuickReply = (text: string) => {
    const el = textareaRef.current;
    if (!el) return;
    el.value = el.value.trim() ? `${el.value.replace(/\s+$/, "")}\n${text}` : text;
    el.focus();
  };

  const toBubbleAttachments = (messageId: string) =>
    (attachmentsByMessage[messageId] ?? []).map((att) => ({
      id: att.id,
      name: att.file_name,
      href: `/api/attachments/${encodeURIComponent(att.file_key)}`,
      icon: getAttachmentIcon(att.file_name, att.mime_type),
    }));

  const initials = (name?: string | null) =>
    (name ?? "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0] ?? "").join("").toUpperCase() || "?";

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
    <div className="mx-auto max-w-[1200px] space-y-5">
      {lightboxIndex !== null && allLightboxItems.length > 0 && (
        <AttachmentLightbox
          items={allLightboxItems}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
      <div className="space-y-2.5">
        <a href="/admin/tickets" className="text-[13px] text-muted-ink hover:text-ink">
          {t("rd_ticket_back")}
        </a>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[13px] text-muted-ink">
              #{ticket.id.slice(0, 8)}
              {client?.company_name ? ` · ${client.company_name}` : ""}
            </p>
            <h1 className="mt-1 text-[24px] md:text-[28px] font-bold tracking-[-0.02em] text-ink break-words">
              {ticket.title}
            </h1>
          </div>
          <Form method="post" className="flex flex-wrap gap-2" aria-label={t("admin_ticket_change_status")}>
            <input type="hidden" name="intent" value="status" />
            {STATUSES.map((s) => (
              <button
                key={s}
                type="submit"
                name="status"
                value={s}
                disabled={ticket.status === s}
                className={`h-10 rounded-full px-4 text-[13px] font-semibold transition-colors ${
                  ticket.status === s
                    ? "bg-ink text-white cursor-default"
                    : "border border-line bg-white text-ink-soft hover:bg-paper"
                }`}
              >
                {t(statusToKey(s))}
              </button>
            ))}
          </Form>
        </div>
        <StatusStepper status={ticket.status} lang={lang} />
      </div>

      <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
      {/* Chat layout: the thread scrolls inside the card and the composer stays
          in view, instead of the whole page growing with every message. */}
      <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-[20px] border border-line bg-white lg:sticky lg:top-4 lg:h-[calc(100dvh-8rem)] lg:min-h-[520px]">
        {/* Conversation (team = ink, client = paper, internal = yellow dashed) */}
        <ChatThread
          className="max-h-[65dvh] min-h-[240px] lg:max-h-none lg:min-h-0 lg:flex-1"
          showEarlierLabel={(n) => (lang === "en" ? `Show ${n} earlier messages` : `แสดงข้อความก่อนหน้า (${n})`)}
          empty={<p className="py-2 text-center text-xs text-faint-ink">{t("rd_ticket_no_messages")}</p>}
          first={
          <div className="flex gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] bg-[#F0EEE7] text-[13px] font-bold text-ink">
              {initials(client?.company_name)}
            </span>
            <div className="min-w-0 flex-1">
              <MessageBubble
                message={ticket.description}
                isClient={true}
                isInternal={false}
                alignRight={false}
                authorName={`${client?.company_name ?? t("rd_ticket_client_label")} · ${formatDate(ticket.created_at, lang)}`}
              />
            </div>
          </div>
          }
          items={messages.map((msg) => {
            const author = usersById[msg.user_id];
            const isTeam = !!author;
            const isNote = msg.is_internal === 1;
            const who = isTeam ? author.name : client?.company_name ?? t("rd_ticket_client_label");
            return { key: msg.id, node: (
              <div
                id={`msg-${msg.id}`}
                className={`flex gap-3 ${isTeam ? "flex-row-reverse" : ""}`}
              >
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] text-[13px] font-bold ${
                    isTeam ? "bg-ink text-brand-yellow" : "bg-[#F0EEE7] text-ink"
                  }`}
                >
                  {initials(who)}
                </span>
                <div className="min-w-0 flex-1">
                  <MessageBubble
                    message={msg.message}
                    isClient={!isTeam}
                    isInternal={isNote}
                    alignRight={isTeam}
                    internalLabel={t("rd_ticket_internal_label")}
                    authorName={`${who} · ${formatRelativeTime(msg.created_at, lang)}`}
                    attachments={toBubbleAttachments(msg.id)}
                    onAttachmentClick={(a) => openLightbox(a.id)}
                  />
                </div>
              </div>
            ) };
          })}
        />

      {/* Reply form — pinned under the thread */}
      <div key={messages.length} className="shrink-0 border-t border-line-soft bg-white px-4 pb-4 pt-3 md:px-5 lg:max-h-[50%] lg:overflow-y-auto">
        <Form method="post" ref={formRef} className="space-y-3">
          <input type="hidden" name="intent" value="reply" />
          <input type="hidden" name="is_internal" value={composeMode === "internal" ? "1" : ""} />
          <div className="inline-flex rounded-full bg-paper p-[3px]" role="tablist">
            {(["reply", "internal"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={composeMode === m}
                onClick={() => setComposeMode(m)}
                className={`h-[34px] rounded-full px-3.5 text-xs font-semibold transition-colors ${
                  composeMode === m
                    ? m === "internal"
                      ? "bg-[#FFF8CC] text-[#3A3000] shadow-[0_1px_2px_rgba(0,0,0,0.08)]"
                      : "bg-white text-ink shadow-[0_1px_2px_rgba(0,0,0,0.08)]"
                    : "text-muted-ink hover:text-ink"
                }`}
              >
                {t(m === "reply" ? "rd_ticket_mode_reply" : "rd_ticket_mode_internal")}
              </button>
            ))}
          </div>
          <input type="hidden" name="attachments_json" value={JSON.stringify(uploadedFiles)} />
          <label htmlFor="admin-ticket-reply" className="sr-only">
            {t("admin_ticket_reply_label")}
          </label>
          <textarea
            id="admin-ticket-reply"
            ref={textareaRef}
            name="message"
            rows={3}
            required
            className={`w-full resize-y rounded-[14px] border px-3.5 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-ink/10 focus:border-ink/40 ${
              composeMode === "internal" ? "border-dashed border-[#E3CF5C] bg-[#FFFCE8]" : "border-line bg-white"
            }`}
            placeholder={t(composeMode === "internal" ? "rd_ticket_ph_internal" : "rd_ticket_ph_reply")}
          />
          {errors?.message && (
            <p className="text-xs text-rose-600">{errors.message[0]}</p>
          )}
          <div className="space-y-1">
            <label className="block text-xs font-medium text-muted-ink">
              {t("rd_ticket_attach")}
            </label>
            <input
              type="file"
              accept="application/pdf,image/*,video/*"
              multiple
              onChange={(e) => void onAttachmentSelect(e.target.files)}
              className="block w-full text-xs text-muted-ink file:mr-3 file:rounded-md file:border file:border-line file:bg-white file:px-2.5 file:py-2 mt-2"
            />
            {uploading ? (
              <div className="space-y-2 mt-2">
                <p className="text-xs text-muted-ink">Uploading... {uploadProgress}%</p>
                <div className="h-1.5 w-full rounded bg-line overflow-hidden">
                  <div
                    className="h-full bg-ink transition-all"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              </div>
            ) : null}
            {uploadError ? <p className="text-xs text-rose-600">{uploadError}</p> : null}
            {uploadedFiles.length > 0 ? (
              <ul className="text-xs text-muted-ink space-y-2 mt-2 max-w-[500px] bg-paper rounded-lg p-2">
                {uploadedFiles.map((f) => (
                  <li
                    key={f.fileKey}
                    className="flex items-center justify-between gap-2 bg-paper rounded px-2 py-1"
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
                      className="rounded-md border border-line bg-white px-2 py-0.5 text-[11px] text-muted-ink hover:bg-paper"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-1.5">
              {(["rd_ticket_quick_1", "rd_ticket_quick_2", "rd_ticket_quick_3"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => insertQuickReply(t(k))}
                  className="h-[34px] rounded-full border border-line bg-white px-3 text-xs text-ink-soft hover:bg-paper"
                >
                  {t(k)}
                </button>
              ))}
            </div>
            <button
              type="submit"
              className="inline-flex h-10 items-center rounded-full bg-ink px-5 text-[13px] font-semibold text-white hover:bg-black transition-colors"
            >
              {t(composeMode === "internal" ? "rd_ticket_mode_internal" : "admin_ticket_send")}
            </button>
          </div>
        </Form>
      </div>
      </section>

      <aside className="flex w-full shrink-0 flex-col gap-3 lg:sticky lg:top-4 lg:w-[300px]">
        <div className="flex flex-col gap-3.5 rounded-[20px] border border-line bg-white p-[18px]">
          <div className="flex items-center justify-between gap-3 text-[13px]">
            <span className="text-muted-ink">{t("admin_ticket_meta_status")}</span>
            <StatusBadge status={ticket.status} />
          </div>
          <div className="flex items-center justify-between gap-3 text-[13px]">
            <span className="text-muted-ink">{t("admin_ticket_meta_priority")}</span>
            <PriorityBadge priority={ticket.priority} />
          </div>
          <div className="flex justify-between gap-3 text-[13px]">
            <span className="text-muted-ink">{t("admin_ticket_meta_client")}</span>
            <span className="text-right font-semibold">{client?.company_name ?? "—"}</span>
          </div>
          <div className="flex justify-between gap-3 text-[13px]">
            <span className="text-muted-ink">{t("admin_ticket_meta_opened")}</span>
            <span className="text-right font-semibold">{formatDate(ticket.created_at, lang)}</span>
          </div>
          <div className="flex justify-between gap-3 text-[13px]">
            <span className="text-muted-ink">{t("admin_tickets_col_updated")}</span>
            <span className="text-right font-semibold">{formatRelativeTime(ticket.updated_at, lang)}</span>
          </div>
        </div>
        {client ? (
          <div className="rounded-[20px] border border-line bg-white p-[18px]">
            <p className="mb-2.5 text-[13px] font-semibold">{t("rd_ticket_this_client")}</p>
            <p className="text-[13px] leading-[1.7] text-muted-ink break-words">
              {client.website_url ? (
                <>
                  {client.website_url.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                  <br />
                </>
              ) : null}
              {t("admin_col_package")}: <span className="capitalize">{client.package}</span>
            </p>
            <a
              href={`/admin/clients/${client.id}`}
              className="mt-2.5 inline-block text-[13px] font-semibold text-ink hover:underline"
            >
              {t("rd_ticket_view_client")}
            </a>
          </div>
        ) : null}
      </aside>
      </div>
    </div>
  );
}
