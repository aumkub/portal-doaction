import { Form, redirect } from "react-router";
import { ConfirmButton } from "~/components/ui/confirm-button";
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
  medium: "bg-brand-yellow",
  low:    "bg-line",
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
          className="inline-flex items-center gap-1.5 text-xs text-muted-ink hover:text-ink-soft transition-colors"
        >
          ← Tickets
        </a>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-paper">
          <FaTrash className="text-muted-ink text-sm" />
        </div>
        <div>
          <h1 className="text-[28px] md:text-[32px] font-bold tracking-[-0.02em] text-ink">Ticket Trash</h1>
          <p className="text-sm text-muted-ink mt-0.5">
            Tickets ที่ลูกค้าลบแล้ว — เฉพาะ Admin เท่านั้นที่สามารถลบถาวรได้
          </p>
        </div>
      </div>

      {/* Warning banner */}
      {tickets.length > 0 && (
        <div className="flex items-start gap-3 rounded-[16px] border border-[#E3CF5C] bg-[#FFF8CC] px-4 py-3">
          <FaTriangleExclamation className="text-[#8A6D00] text-sm mt-0.5 shrink-0" />
          <p className="text-sm text-[#6B5B00]">
            การลบถาวรจะไม่สามารถยกเลิกได้ และข้อมูลทั้งหมดรวมถึงข้อความและไฟล์แนบจะหายไปตลอดกาล
          </p>
        </div>
      )}

      {/* List */}
      <div className="overflow-hidden rounded-[20px] border border-line bg-white ">
        {tickets.length === 0 ? (
          <div className="px-5 py-16 text-center">
            <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-paper text-faint-ink"><FaTrash className="text-base" /></span>
            <p className="text-sm text-muted-ink">ไม่มี Ticket ในถังขยะ</p>
          </div>
        ) : (
          <>
            <div className="hidden lg:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line-soft bg-paper text-[11px] font-medium uppercase tracking-wider text-muted-ink">
                    <th className="text-left px-4 py-2.5">Ticket</th>
                    <th className="text-left px-4 py-2.5">ลูกค้า</th>
                    <th className="text-left px-4 py-2.5">Priority</th>
                    <th className="text-left px-4 py-2.5">ลบเมื่อ</th>
                    <th className="px-5 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-soft">
                  {tickets.map((ticket) => (
                    <tr key={ticket.id} className="hover:bg-paper transition-colors">
                      <td className="px-4 py-3">
                        <p className="font-medium text-ink truncate max-w-[280px]">{ticket.title}</p>
                        <p className="text-xs text-muted-ink font-mono mt-0.5">#{ticket.id.slice(0, 8)}</p>
                      </td>
                      <td className="px-4 py-3 text-muted-ink">{ticket.company_name}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-ink">
                          <span className={`h-1.5 w-1.5 rounded-full ${priorityDot[ticket.priority] ?? "bg-line"}`} />
                          {ticket.priority}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-ink text-xs">
                        {ticket.deleted_at ? formatDate(ticket.deleted_at, lang) : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 justify-end">
                          <Form method="post">
                            <input type="hidden" name="intent" value="restore" />
                            <input type="hidden" name="ticketId" value={ticket.id} />
                            <button
                              type="submit"
                              className="inline-flex items-center gap-1.5 h-8 rounded-full border border-line bg-white px-2.5 text-xs font-medium text-ink-soft hover:bg-paper transition-colors"
                            >
                              <FaRotateLeft className="text-[10px]" />
                              คืนค่า
                            </button>
                          </Form>
                          <Form method="post">
                            <input type="hidden" name="intent" value="permanent_delete" />
                            <input type="hidden" name="ticketId" value={ticket.id} />
                            <ConfirmButton
                              message={`ลบ "${ticket.title}" ถาวร ไม่สามารถยกเลิกได้`}
                              confirmLabel="ลบถาวร"
                              destructive
                              className="inline-flex items-center gap-1.5 h-8 rounded-full border border-[#F3C9B0] bg-white px-2.5 text-xs font-medium text-[#B4541A] hover:bg-[#FDE7DA] transition-colors"
                            >
                              <FaTrash className="text-[10px]" />
                              ลบถาวร
                            </ConfirmButton>
                          </Form>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Cards — mobile */}
            <div className="lg:hidden divide-y divide-line-soft">
              {tickets.map((ticket) => (
                <div key={ticket.id} className="p-4 space-y-3">
                  <div>
                    <p className="font-medium text-ink text-sm">{ticket.title}</p>
                    <p className="text-xs text-muted-ink mt-0.5">{ticket.company_name}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap text-xs text-muted-ink">
                    <span className="inline-flex items-center gap-1.5">
                      <span className={`h-1.5 w-1.5 rounded-full ${priorityDot[ticket.priority] ?? "bg-line"}`} />
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
                        className="inline-flex items-center gap-1.5 h-8 rounded-full border border-line bg-white px-2.5 text-xs font-medium text-ink-soft hover:bg-paper transition-colors"
                      >
                        <FaRotateLeft className="text-[10px]" />
                        คืนค่า
                      </button>
                    </Form>
                    <Form method="post">
                      <input type="hidden" name="intent" value="permanent_delete" />
                      <input type="hidden" name="ticketId" value={ticket.id} />
                      <ConfirmButton
                        message={`ลบ "${ticket.title}" ถาวร ไม่สามารถยกเลิกได้`}
                        confirmLabel="ลบถาวร "
                        destructive
                        className="inline-flex items-center gap-1.5 h-8 rounded-full border border-[#F3C9B0] bg-white px-2.5 text-xs font-medium text-[#B4541A] hover:bg-[#FDE7DA] transition-colors"
                      >
                        <FaTrash className="text-[10px]" />
                        ลบถาวร
                      </ConfirmButton>
                    </Form>
                  </div>
                </div>
              ))}
            </div>

            <div className="border-t border-line-soft px-5 py-2.5 bg-paper/40">
              <p className="text-xs text-muted-ink">{tickets.length} รายการในถังขยะ</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
