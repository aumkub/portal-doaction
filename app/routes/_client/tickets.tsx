import { Form, useSearchParams } from "react-router";
import { useState } from "react";
import type { Route } from "./+types/tickets";
import { requireUser } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";
import { generateId, formatRelativeTime } from "~/lib/utils";
import { z } from "zod";
import type { SupportTicket, TicketStatus, TicketPriority } from "~/types";
import { FaCircle } from "react-icons/fa6";

export function meta() {
  return [{ title: "Support Tickets — do action portal" }];
}

const NewTicketSchema = z.object({
  title: z.string().min(1, "กรุณาระบุหัวข้อ"),
  description: z.string().min(10, "กรุณาอธิบายรายละเอียด"),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
});

export async function action({ request, context }: Route.ActionArgs) {
  const user = await requireUser(request, context.cloudflare.env.DB, context.cloudflare.env.SESSIONPORTAL);
  const db = createDB(context.cloudflare.env.DB);
  const client = await db.getClientByUserId(user.id);
  if (!client) return { error: "ไม่พบข้อมูลลูกค้า" };

  const formData = await request.formData();
  const parsed = NewTicketSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  await db.createTicket({
    id: generateId(),
    client_id: client.id,
    title: parsed.data.title,
    description: parsed.data.description,
    priority: parsed.data.priority,
    status: "open",
    created_by: user.id,
    assigned_to: null,
    resolved_at: null,
  });

  return { success: true };
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const user = await requireUser(request, context.cloudflare.env.DB, context.cloudflare.env.SESSIONPORTAL);
  const db = createDB(context.cloudflare.env.DB);
  const client = await db.getClientByUserId(user.id);
  if (!client) return { tickets: [], client: null };

  const tickets = await db.listTicketsByClient(client.id);
  return { tickets, client };
}

const statusConfig: Record<
  TicketStatus,
  { label: string; color: string; dotClass: string }
> = {
  open: { label: "เปิด", color: "text-amber-600 bg-amber-50", dotClass: "text-amber-500" },
  in_progress: {
    label: "กำลังดำเนิน",
    color: "text-blue-600 bg-blue-50",
    dotClass: "text-blue-500",
  },
  waiting: {
    label: "รอข้อมูล",
    color: "text-slate-600 bg-slate-100",
    dotClass: "text-slate-500",
  },
  resolved: {
    label: "เสร็จสิ้น",
    color: "text-emerald-600 bg-emerald-50",
    dotClass: "text-emerald-500",
  },
  closed: {
    label: "ปิดแล้ว",
    color: "text-slate-500 bg-slate-100",
    dotClass: "text-slate-500",
  },
};

const priorityLabels: Record<TicketPriority, string> = {
  low: "ต่ำ",
  medium: "กลาง",
  high: "สูง",
  urgent: "เร่งด่วน",
};

export default function TicketsPage({ loaderData, actionData }: Route.ComponentProps) {
  const { tickets } = loaderData as { tickets: SupportTicket[] };
  const [searchParams, setSearchParams] = useSearchParams();
  const [filter, setFilter] = useState<TicketStatus | "all">("all");
  const showNew = searchParams.get("new") === "1";

  const filtered =
    filter === "all" ? tickets : tickets.filter((t) => t.status === filter);

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">
            Support Tickets
          </h1>
          <p className="text-slate-500 text-sm mt-1">
            ติดต่อทีมหรือแจ้งงานที่ต้องการ
          </p>
        </div>
        <button
          onClick={() => setSearchParams({ new: "1" })}
          className="flex items-center gap-2 bg-[#F0D800] text-slate-900 rounded-lg px-4 py-2 text-sm font-medium hover:bg-yellow-400 transition-colors"
        >
          + สร้าง Ticket ใหม่
        </button>
      </div>

      {/* New ticket form */}
      {showNew && (
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h2 className="text-sm font-semibold text-slate-900 mb-4">
            สร้าง Ticket ใหม่
          </h2>
          <Form method="post" className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                หัวข้อ
              </label>
              <input
                name="title"
                required
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
                placeholder="เช่น แก้ไขรูปภาพหน้าแรก"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                รายละเอียด
              </label>
              <textarea
                name="description"
                required
                rows={4}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 resize-none"
                placeholder="อธิบายรายละเอียดงานที่ต้องการ..."
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                ความสำคัญ
              </label>
              <select
                name="priority"
                defaultValue="medium"
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-900"
              >
                <option value="low">ต่ำ</option>
                <option value="medium">กลาง</option>
                <option value="high">สูง</option>
                <option value="urgent">เร่งด่วน</option>
              </select>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setSearchParams({})}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 transition-colors"
              >
                ยกเลิก
              </button>
              <button
                type="submit"
                className="rounded-lg bg-slate-900 text-white px-4 py-2 text-sm font-medium hover:bg-slate-800 transition-colors"
              >
                ส่ง Ticket
              </button>
            </div>
          </Form>
        </div>
      )}

      {/* Filter */}
      <div className="flex gap-2">
        {(["all", "open", "in_progress", "resolved"] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setFilter(s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              filter === s
                ? "bg-slate-900 text-white"
                : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
            }`}
          >
            {s === "all"
              ? "ทั้งหมด"
              : statusConfig[s as TicketStatus]?.label ?? s}
          </button>
        ))}
      </div>

      {/* Ticket list */}
      <div className="space-y-3">
        {filtered.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
            <p className="text-slate-500 text-sm">ไม่มี Ticket</p>
          </div>
        ) : (
          filtered.map((ticket) => {
            const st = statusConfig[ticket.status];
            return (
              <div
                key={ticket.id}
                className="bg-white rounded-xl border border-slate-200 p-5 hover:border-slate-300 transition-colors cursor-pointer"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-700 truncate">
                      {ticket.title}
                    </p>
                    <p className="text-xs text-slate-500 mt-1">
                      {formatRelativeTime(ticket.created_at)} ·{" "}
                      {priorityLabels[ticket.priority]}
                    </p>
                  </div>
                  <span
                    className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full whitespace-nowrap ${st.color}`}
                  >
                    <FaCircle className={`text-[9px] ${st.dotClass}`} aria-hidden="true" /> {st.label}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
