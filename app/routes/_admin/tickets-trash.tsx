import { Form, redirect } from "react-router";
import { requireAdmin } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";
import { formatDate } from "~/lib/utils";
import { useT } from "~/lib/i18n";
import type { SupportTicket } from "~/types";
import { FaTrash, FaRotateLeft, FaTriangleExclamation } from "react-icons/fa6";

export function meta() {
  return [{ title: "Ticket Trash — Admin" }];
}

export async function loader({ request, context }: any) {
  await requireAdmin(request, context.cloudflare.env.DB, context.cloudflare.env.SESSIONPORTAL);
  const db = createDB(context.cloudflare.env.DB);
  const tickets = await db.listTrashedTickets();
  return { tickets };
}

export async function action({ request, context }: any) {
  await requireAdmin(request, context.cloudflare.env.DB, context.cloudflare.env.SESSIONPORTAL);
  const db = createDB(context.cloudflare.env.DB);
  const formData = await request.formData();
  const intent = formData.get("intent");
  const ticketId = formData.get("ticketId") as string;

  if (!ticketId) return null;

  if (intent === "restore") {
    await db.restoreTicket(ticketId);
  } else if (intent === "permanent_delete") {
    await db.permanentlyDeleteTicket(ticketId);
  }

  return redirect("/admin/tickets/trash");
}

const priorityDot: Record<string, string> = {
  urgent: "bg-red-500",
  high:   "bg-orange-400",
  medium: "bg-amber-400",
  low:    "bg-slate-300",
};

type TrashedTicket = SupportTicket & { company_name: string };

export default function AdminTicketsTrashPage({ loaderData }: any) {
  const { tickets } = loaderData as { tickets: TrashedTicket[] };
  const { lang } = useT();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <a
          href="/admin/tickets"
          className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 transition-colors"
        >
          ← Tickets
        </a>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-50">
          <FaTrash className="text-red-500 text-sm" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Ticket Trash</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Tickets ที่ลูกค้าลบแล้ว — เฉพาะ Admin เท่านั้นที่สามารถลบถาวรได้
          </p>
        </div>
      </div>

      {/* Warning banner */}
      {tickets.length > 0 && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <FaTriangleExclamation className="text-amber-500 text-sm mt-0.5 shrink-0" />
          <p className="text-sm text-amber-700">
            การลบถาวรจะไม่สามารถยกเลิกได้ และข้อมูลทั้งหมดรวมถึงข้อความและไฟล์แนบจะหายไปตลอดกาล
          </p>
        </div>
      )}

      {/* List */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {tickets.length === 0 ? (
          <div className="px-5 py-16 text-center">
            <FaTrash className="mx-auto mb-3 text-3xl text-slate-200" />
            <p className="text-sm text-slate-500">ไม่มี Ticket ในถังขยะ</p>
          </div>
        ) : (
          <>
            <div className="hidden lg:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/60">
                    <th className="text-left text-xs font-medium text-slate-500 px-5 py-3">Ticket</th>
                    <th className="text-left text-xs font-medium text-slate-500 px-5 py-3">ลูกค้า</th>
                    <th className="text-left text-xs font-medium text-slate-500 px-5 py-3">Priority</th>
                    <th className="text-left text-xs font-medium text-slate-500 px-5 py-3">ลบเมื่อ</th>
                    <th className="px-5 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {tickets.map((ticket) => (
                    <tr key={ticket.id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="px-5 py-3.5">
                        <p className="font-medium text-slate-800 truncate max-w-[280px]">{ticket.title}</p>
                        <p className="text-xs text-slate-500 font-mono mt-0.5">#{ticket.id.slice(0, 8)}</p>
                      </td>
                      <td className="px-5 py-3.5 text-slate-600">{ticket.company_name}</td>
                      <td className="px-5 py-3.5">
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600">
                          <span className={`h-1.5 w-1.5 rounded-full ${priorityDot[ticket.priority] ?? "bg-slate-300"}`} />
                          {ticket.priority}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-slate-500 text-xs">
                        {ticket.deleted_at ? formatDate(ticket.deleted_at, lang) : "—"}
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2 justify-end">
                          <Form method="post">
                            <input type="hidden" name="intent" value="restore" />
                            <input type="hidden" name="ticketId" value={ticket.id} />
                            <button
                              type="submit"
                              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100 transition-colors"
                            >
                              <FaRotateLeft className="text-[10px]" />
                              คืนค่า
                            </button>
                          </Form>
                          <Form
                            method="post"
                            onSubmit={(e) => {
                              if (!confirm(`ลบ "${ticket.title}" ถาวรใช่หรือไม่? ไม่สามารถยกเลิกได้`)) {
                                e.preventDefault();
                              }
                            }}
                          >
                            <input type="hidden" name="intent" value="permanent_delete" />
                            <input type="hidden" name="ticketId" value={ticket.id} />
                            <button
                              type="submit"
                              className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-100 transition-colors"
                            >
                              <FaTrash className="text-[10px]" />
                              ลบถาวร
                            </button>
                          </Form>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Cards — mobile */}
            <div className="lg:hidden divide-y divide-slate-100">
              {tickets.map((ticket) => (
                <div key={ticket.id} className="p-4 space-y-3">
                  <div>
                    <p className="font-medium text-slate-800 text-sm">{ticket.title}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{ticket.company_name}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap text-xs text-slate-500">
                    <span className="inline-flex items-center gap-1.5">
                      <span className={`h-1.5 w-1.5 rounded-full ${priorityDot[ticket.priority] ?? "bg-slate-300"}`} />
                      {ticket.priority}
                    </span>
                    {ticket.deleted_at && (
                      <span>ลบเมื่อ {formatDate(ticket.deleted_at, lang)}</span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Form method="post">
                      <input type="hidden" name="intent" value="restore" />
                      <input type="hidden" name="ticketId" value={ticket.id} />
                      <button
                        type="submit"
                        className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100 transition-colors"
                      >
                        <FaRotateLeft className="text-[10px]" />
                        คืนค่า
                      </button>
                    </Form>
                    <Form
                      method="post"
                      onSubmit={(e) => {
                        if (!confirm(`ลบ "${ticket.title}" ถาวรใช่หรือไม่?`)) e.preventDefault();
                      }}
                    >
                      <input type="hidden" name="intent" value="permanent_delete" />
                      <input type="hidden" name="ticketId" value={ticket.id} />
                      <button
                        type="submit"
                        className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-100 transition-colors"
                      >
                        <FaTrash className="text-[10px]" />
                        ลบถาวร
                      </button>
                    </Form>
                  </div>
                </div>
              ))}
            </div>

            <div className="border-t border-slate-100 px-5 py-2.5 bg-slate-50/40">
              <p className="text-xs text-slate-500">{tickets.length} รายการในถังขยะ</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
