import { Form, Link, redirect } from "react-router";
import { z } from "zod";
import { requireUser } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";
import { formatDate, generateId } from "~/lib/utils";
import type { SupportTicket, TicketMessage, User } from "~/types";
import StatusBadge from "~/components/tickets/StatusBadge";
import PriorityBadge from "~/components/tickets/PriorityBadge";
import MessageBubble from "~/components/tickets/MessageBubble";

const ReplySchema = z.object({
  message: z.string().min(1, "กรุณาพิมพ์ข้อความ"),
});

type LoaderData = {
  ticket: SupportTicket;
  messages: TicketMessage[];
  usersById: Record<string, User>;
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

  const [messages, admins] = await Promise.all([
    db.listMessagesByTicket(ticket.id),
    db.listAdminUsers(),
  ]);

  const usersById: Record<string, User> = {};
  for (const admin of admins) usersById[admin.id] = admin;
  usersById[user.id] = user;

  return { ticket, messages, usersById };
}

export async function action({ request, context, params }: any) {
  const user = await requireUser(
    request,
    context.cloudflare.env.DB,
    context.cloudflare.env.SESSIONPORTAL
  );
  const db = createDB(context.cloudflare.env.DB);
  const ticket = await db.getTicket(params.ticketId);
  if (!ticket) throw new Response("Ticket not found", { status: 404 });

  const formData = await request.formData();
  const parsed = ReplySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  await db.createTicketMessage({
    id: generateId(),
    ticket_id: ticket.id,
    user_id: user.id,
    message: parsed.data.message,
    is_internal: 0,
  });

  if (ticket.status === "resolved" || ticket.status === "closed") {
    await db.updateTicket(ticket.id, { status: "in_progress", resolved_at: null });
  }

  return redirect(`/tickets/${ticket.id}`);
}

export default function TicketDetailPage({ loaderData, actionData }: any) {
  const { ticket, messages, usersById } = loaderData as LoaderData;
  const errors = actionData?.errors;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium text-slate-400">#{ticket.id}</p>
          <h1 className="text-2xl font-semibold text-slate-900">{ticket.title}</h1>
          <p className="mt-1 text-sm text-slate-500">
            สร้างเมื่อ {formatDate(ticket.created_at)}
          </p>
        </div>
        <Link to="/tickets" className="text-sm text-slate-500 hover:text-slate-900">
          ← กลับ
        </Link>
      </div>

      <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-3">
        <div>
          <p className="text-xs text-slate-500">สถานะ</p>
          <div className="mt-1">
            <StatusBadge status={ticket.status} />
          </div>
        </div>
        <div>
          <p className="text-xs text-slate-500">ความสำคัญ</p>
          <div className="mt-1">
            <PriorityBadge priority={ticket.priority} />
          </div>
        </div>
        <div>
          <p className="text-xs text-slate-500">เปิดเมื่อ</p>
          <p className="mt-1 text-sm font-medium text-slate-700">
            {formatDate(ticket.created_at)}
          </p>
        </div>
      </div>

      <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <MessageBubble message={ticket.description} isClient={true} isInternal={false} />
        {messages
          .filter((msg) => msg.is_internal === 0)
          .map((msg) => (
            <MessageBubble
              key={msg.id}
              message={msg.message}
              isClient={usersById[msg.user_id]?.role !== "admin"}
              isInternal={msg.is_internal === 1}
              authorName={usersById[msg.user_id]?.name}
            />
          ))}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <Form method="post" className="space-y-3">
          <label className="block text-sm font-medium text-slate-700">ตอบกลับ</label>
          <textarea
            name="message"
            rows={4}
            required
            placeholder="พิมพ์ข้อความ..."
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
          />
          {errors?.message ? (
            <p className="text-xs text-rose-600">{errors.message[0]}</p>
          ) : null}
          <div className="flex justify-end">
            <button
              type="submit"
              className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700"
            >
              ส่งข้อความ
            </button>
          </div>
        </Form>
      </div>
    </div>
  );
}
