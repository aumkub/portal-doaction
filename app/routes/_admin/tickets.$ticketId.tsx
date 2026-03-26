import { Form, Link, redirect } from "react-router";
import { z } from "zod";
import { requireAdmin } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";
import { formatDate, generateId } from "~/lib/utils";
import type { SupportTicket, TicketMessage, User, Client } from "~/types";
import StatusBadge from "~/components/tickets/StatusBadge";
import PriorityBadge from "~/components/tickets/PriorityBadge";
import MessageBubble from "~/components/tickets/MessageBubble";
import PageHeader from "~/components/layout/PageHeader";

const ReplySchema = z.object({
  message: z.string().min(1, "กรุณาพิมพ์ข้อความ"),
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

  const [messages, admins, client] = await Promise.all([
    db.listMessagesByTicket(ticket.id),
    db.listAdminUsers(),
    db.getClientById(ticket.client_id),
  ]);

  const usersById: Record<string, User> = {};
  for (const a of admins) usersById[a.id] = a;

  return { ticket, messages, usersById, client, admin };
}

const STATUSES = [
  { value: "open", label: "เปิด" },
  { value: "in_progress", label: "กำลังดำเนิน" },
  { value: "waiting", label: "รอข้อมูล" },
  { value: "resolved", label: "เสร็จสิ้น" },
  { value: "closed", label: "ปิด" },
] as const;

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

  if (intent === "status" && status) {
    const updateData: any = { status };
    if (status === "resolved") updateData.resolved_at = Math.floor(Date.now() / 1000);
    if (status === "open" || status === "in_progress") updateData.resolved_at = null;
    await db.updateTicket(ticket.id, updateData);

    // Notify client of status change
    const client = await db.getClientById(ticket.client_id);
    if (client) {
      const statusLabel = STATUSES.find((s) => s.value === status)?.label ?? status;
      await db.createNotification({
        id: generateId(),
        user_id: client.user_id,
        type: "ticket_update",
        title: `Ticket อัปเดต: ${ticket.title}`,
        body: `สถานะเปลี่ยนเป็น ${statusLabel}`,
        link: `/tickets/${ticket.id}`,
        read: 0,
      });
    }
    return redirect(`/admin/tickets/${ticket.id}`);
  }

  // Reply
  const isInternal = is_internal === "1" ? 1 : 0;
  await db.createTicketMessage({
    id: generateId(),
    ticket_id: ticket.id,
    user_id: admin.id,
    message,
    is_internal: isInternal,
  });

  if (!isInternal) {
    // Update status to in_progress when admin replies
    if (ticket.status === "open") {
      await db.updateTicket(ticket.id, { status: "in_progress" });
    }

    // Notify client
    const client = await db.getClientById(ticket.client_id);
    if (client) {
      await db.createNotification({
        id: generateId(),
        user_id: client.user_id,
        type: "ticket_reply",
        title: `มีข้อความใหม่ใน: ${ticket.title}`,
        body: message.slice(0, 100),
        link: `/tickets/${ticket.id}`,
        read: 0,
      });
    }
  }

  return redirect(`/admin/tickets/${ticket.id}`);
}

export default function AdminTicketDetailPage({ loaderData, actionData }: any) {
  const { ticket, messages, usersById, client } = loaderData as {
    ticket: SupportTicket;
    messages: TicketMessage[];
    usersById: Record<string, User>;
    client: Client | null;
  };
  const errors = actionData?.errors;

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        title={ticket.title}
        subtitle={client?.company_name ?? undefined}
        breadcrumbs={[
          { label: "Admin" },
          { label: "Tickets", href: "/admin/tickets" },
          { label: `#${ticket.id.slice(0, 8)}` },
        ]}
      />

      {/* Meta row */}
      <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-4">
        <div>
          <p className="text-xs text-slate-500 mb-1">สถานะ</p>
          <StatusBadge status={ticket.status} />
        </div>
        <div>
          <p className="text-xs text-slate-500 mb-1">Priority</p>
          <PriorityBadge priority={ticket.priority} />
        </div>
        <div>
          <p className="text-xs text-slate-500 mb-1">ลูกค้า</p>
          <p className="text-sm font-medium text-slate-700">{client?.company_name ?? "—"}</p>
        </div>
        <div>
          <p className="text-xs text-slate-500 mb-1">เปิดเมื่อ</p>
          <p className="text-sm text-slate-700">{formatDate(ticket.created_at)}</p>
        </div>
      </div>

      {/* Status change */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-xs font-medium text-slate-600 mb-3">เปลี่ยนสถานะ</p>
        <Form method="post" className="flex flex-wrap gap-2">
          <input type="hidden" name="intent" value="status" />
          <input type="hidden" name="message" value="" />
          {STATUSES.map((s) => (
            <button
              key={s.value}
              type="submit"
              name="status"
              value={s.value}
              disabled={ticket.status === s.value}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                ticket.status === s.value
                  ? "bg-slate-900 text-white border-slate-900 cursor-default"
                  : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
              }`}
            >
              {s.label}
            </button>
          ))}
        </Form>
      </div>

      {/* Message thread */}
      <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <MessageBubble message={ticket.description} isClient={true} isInternal={false} />
        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            message={msg.message}
            isClient={usersById[msg.user_id]?.role !== "admin"}
            isInternal={msg.is_internal === 1}
            authorName={usersById[msg.user_id]?.name}
          />
        ))}
      </div>

      {/* Reply form */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <Form method="post" className="space-y-3">
          <input type="hidden" name="intent" value="reply" />
          <label className="block text-sm font-medium text-slate-700">ตอบกลับ</label>
          <textarea
            name="message"
            rows={4}
            required
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
            placeholder="พิมพ์ข้อความ..."
          />
          {errors?.message && (
            <p className="text-xs text-rose-600">{errors.message[0]}</p>
          )}
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer select-none">
              <input
                type="checkbox"
                name="is_internal"
                value="1"
                className="rounded border-slate-300 text-violet-600 focus:ring-violet-500"
              />
              Internal note (ไม่แสดงให้ลูกค้าเห็น)
            </label>
            <button
              type="submit"
              className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 transition-colors"
            >
              ส่งข้อความ
            </button>
          </div>
        </Form>
      </div>
    </div>
  );
}
