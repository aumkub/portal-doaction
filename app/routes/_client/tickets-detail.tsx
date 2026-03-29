import { Form } from "react-router";
import type { Route } from "./+types/tickets-detail";
import { requireUser } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";
import { generateId, formatRelativeTime } from "~/lib/utils";
import { z } from "zod";
import PageHeader from "~/components/layout/PageHeader";
import type { SupportTicket, TicketMessage, User } from "~/types";

const statusConfig = {
  open:        { label: "เปิด",          color: "bg-amber-50 text-amber-600" },
  in_progress: { label: "กำลังดำเนิน",   color: "bg-blue-50 text-blue-600" },
  waiting:     { label: "รอข้อมูล",       color: "bg-slate-100 text-slate-600" },
  resolved:    { label: "เสร็จสิ้น",      color: "bg-emerald-50 text-emerald-600" },
  closed:      { label: "ปิดแล้ว",        color: "bg-slate-100 text-slate-400" },
};

const priorityConfig = {
  low:    { label: "ต่ำ",      color: "bg-slate-100 text-slate-500" },
  medium: { label: "กลาง",    color: "bg-blue-50 text-blue-600" },
  high:   { label: "สูง",      color: "bg-amber-50 text-amber-600" },
  urgent: { label: "เร่งด่วน", color: "bg-red-50 text-red-600" },
};

const ReplySchema = z.object({ message: z.string().min(1) });

export function meta() {
  return [{ title: "Ticket Detail — do action portal" }];
}

export async function action({ request, params, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const user = await requireUser(request, env.DB, env.SESSIONPORTAL);
  const db = createDB(env.DB);

  const ticket = await db.getTicket(params.ticketId);
  if (!ticket) throw new Response("Not Found", { status: 404 });

  const client = await db.getClientByUserId(user.id);
  if (!client || ticket.client_id !== client.id) {
    throw new Response("Forbidden", { status: 403 });
  }

  const parsed = ReplySchema.safeParse(
    Object.fromEntries(await request.formData())
  );
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };

  await db.createTicketMessage({
    id: generateId(),
    ticket_id: ticket.id,
    user_id: user.id,
    message: parsed.data.message,
    is_internal: 0,
  });

  return { ok: true };
}

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const user = await requireUser(request, env.DB, env.SESSIONPORTAL);
  const db = createDB(env.DB);

  const ticket = await db.getTicket(params.ticketId);
  if (!ticket) throw new Response("Not Found", { status: 404 });

  const client = await db.getClientByUserId(user.id);
  if (!client || ticket.client_id !== client.id) {
    throw new Response("Forbidden", { status: 403 });
  }

  const messages = await db.listMessagesByTicket(ticket.id);
  return { ticket, messages, user };
}

export default function TicketDetailPage({ loaderData, actionData }: Route.ComponentProps) {
  const { ticket, messages, user } = loaderData as {
    ticket: SupportTicket;
    messages: TicketMessage[];
    user: User;
  };

  const st = statusConfig[ticket.status];
  const pr = priorityConfig[ticket.priority];

  return (
    <div className="space-y-6 max-w-3xl">
      <PageHeader
        title={ticket.title}
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Tickets", href: "/tickets" },
          { label: `#${ticket.id.slice(0, 8)}` },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <span className={`text-xs font-medium px-2 py-1 rounded-full ${pr.color}`}>
              {pr.label}
            </span>
            <span className={`text-xs font-medium px-2 py-1 rounded-full ${st.color}`}>
              {st.label}
            </span>
          </div>
        }
      />

      {/* Description */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
          {ticket.description}
        </p>
        <p className="text-xs text-slate-400 mt-3">
          สร้างเมื่อ {formatRelativeTime(ticket.created_at)}
        </p>
      </div>

      {/* Message thread */}
      <div className="space-y-3">
        {messages.map((msg) => {
          const isOwn = msg.user_id === user.id;
          return (
            <div
              key={msg.id}
              className={`flex ${isOwn ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[80%] rounded-xl px-4 py-3 ${
                  isOwn
                    ? "bg-violet-600 text-white"
                    : "bg-white border border-slate-200 text-slate-700"
                }`}
              >
                <p className="text-sm leading-relaxed whitespace-pre-wrap">
                  {msg.message}
                </p>
                <p
                  className={`text-[11px] mt-1.5 ${
                    isOwn ? "text-violet-200" : "text-slate-400"
                  }`}
                >
                  {formatRelativeTime(msg.created_at)}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Reply box */}
      {!["resolved", "closed"].includes(ticket.status) && (
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <Form method="post" className="space-y-3">
            <textarea
              name="message"
              required
              rows={3}
              placeholder="พิมพ์ข้อความ..."
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 resize-none"
            />
            <div className="flex justify-end">
              <button
                type="submit"
                className="bg-violet-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-violet-700 transition-colors"
              >
                ส่งข้อความ
              </button>
            </div>
          </Form>
        </div>
      )}
    </div>
  );
}
