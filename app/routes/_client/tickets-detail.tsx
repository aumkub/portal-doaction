import { Form } from "react-router";
import type { Route } from "./+types/tickets-detail";
import { requireUser } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";
import { generateId, formatRelativeTime } from "~/lib/utils";
import { z } from "zod";
import PageHeader from "~/components/layout/PageHeader";
import type { SupportTicket, TicketMessage, User } from "~/types";

const statusConfig = {
  open:        { label: "เปิด",          color: "bg-amber-50 text-amber-700 ring-amber-600/20" },
  in_progress: { label: "กำลังดำเนิน",   color: "bg-sky-50 text-sky-700 ring-sky-600/20" },
  waiting:     { label: "รอข้อมูล",       color: "bg-slate-50 text-slate-600 ring-slate-200" },
  resolved:    { label: "เสร็จสิ้น",      color: "bg-emerald-50 text-emerald-700 ring-emerald-600/20" },
  closed:      { label: "ปิดแล้ว",        color: "bg-slate-50 text-slate-500 ring-slate-200" },
};

const priorityConfig = {
  low:    { label: "ต่ำ",      color: "bg-slate-50 text-slate-600 ring-slate-200" },
  medium: { label: "กลาง",    color: "bg-sky-50 text-sky-700 ring-sky-600/20" },
  high:   { label: "สูง",      color: "bg-amber-50 text-amber-700 ring-amber-600/20" },
  urgent: { label: "เร่งด่วน", color: "bg-rose-50 text-rose-700 ring-rose-600/20" },
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
            <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${pr.color}`}>
              {pr.label}
            </span>
            <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${st.color}`}>
              {st.label}
            </span>
          </div>
        }
      />

      {/* Description */}
      <div className="bg-white rounded-xl border border-slate-200/80 shadow-[0_1px_2px_rgba(15,23,42,0.04)] p-5">
        <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
          {ticket.description}
        </p>
        <p className="text-xs text-slate-500 mt-3">
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
                    ? "bg-slate-900 text-white"
                    : "bg-white border border-slate-200/80 text-slate-700 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
                }`}
              >
                <p className="text-sm leading-relaxed whitespace-pre-wrap">
                  {msg.message}
                </p>
                <p
                  className={`text-[11px] mt-1.5 ${
                    isOwn ? "text-slate-400" : "text-slate-500"
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
        <div className="bg-white rounded-xl border border-slate-200/80 shadow-[0_1px_2px_rgba(15,23,42,0.04)] p-5">
          <Form method="post" className="space-y-3">
            <textarea
              name="message"
              required
              rows={3}
              placeholder="พิมพ์ข้อความ..."
              className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm shadow-[0_1px_2px_rgba(15,23,42,0.04)] focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400 resize-none"
            />
            <div className="flex justify-end">
              <button
                type="submit"
                className="h-9 rounded-md bg-slate-900 px-3.5 text-[13px] font-medium text-white hover:bg-slate-800 transition-colors"
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
