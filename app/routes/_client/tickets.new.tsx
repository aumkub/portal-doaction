import { Form, Link, redirect } from "react-router";
import { z } from "zod";
import { requireUser } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";
import { generateId } from "~/lib/utils";

const TicketSchema = z.object({
  title: z.string().min(1, "กรุณากรอกหัวข้อ"),
  description: z.string().min(1, "กรุณาระบุรายละเอียด"),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
});

export function meta() {
  return [{ title: "แจ้งปัญหาใหม่ — DoAction Portal" }];
}

export async function action({ request, context }: any) {
  const user = await requireUser(
    request,
    context.cloudflare.env.DB,
    context.cloudflare.env.SESSIONPORTAL
  );
  const db = createDB(context.cloudflare.env.DB);
  const client = await db.getClientByUserId(user.id);
  if (!client) return { error: "Client not found" };

  const formData = await request.formData();
  const parsed = TicketSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const ticketId = generateId();
  await db.createTicket({
    id: ticketId,
    client_id: client.id,
    title: parsed.data.title,
    description: parsed.data.description,
    priority: parsed.data.priority,
    status: "open",
    created_by: user.id,
    assigned_to: null,
    resolved_at: null,
  });

  // Notify admins when a new ticket arrives.
  const admins = await db.listAdminUsers();
  await Promise.all(
    admins.map((admin) =>
      db.createNotification({
        id: generateId(),
        user_id: admin.id,
        type: "ticket",
        title: `New ticket from ${client.company_name}`,
        body: parsed.data.title,
        link: `/admin/tickets`,
        read: 0,
      })
    )
  );

  return redirect(`/tickets/${ticketId}`);
}

export default function NewTicketPage({ actionData }: any) {
  const errors = actionData?.errors;
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">แจ้งปัญหาใหม่</h1>
        <p className="mt-1 text-sm text-slate-500">
          ส่งหัวข้อและรายละเอียดเพื่อแจ้งทีมงาน
        </p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <Form method="post" className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              หัวข้อ
            </label>
            <input
              name="title"
              required
              placeholder="เช่น เว็บไซต์ไม่สามารถเข้าถึงได้"
              className="h-11 w-full rounded-lg border border-slate-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
            {errors?.title ? (
              <p className="mt-1 text-xs text-rose-600">{errors.title[0]}</p>
            ) : null}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              รายละเอียด
            </label>
            <textarea
              name="description"
              required
              rows={6}
              placeholder="อธิบายปัญหาหรือสิ่งที่ต้องการให้ทีมดำเนินการ..."
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
            {errors?.description ? (
              <p className="mt-1 text-xs text-rose-600">
                {errors.description[0]}
              </p>
            ) : null}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              ความสำคัญ
            </label>
            <select
              name="priority"
              defaultValue="medium"
              className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
            >
              <option value="low">ต่ำ</option>
              <option value="medium">กลาง</option>
              <option value="high">สูง</option>
              <option value="urgent">เร่งด่วน</option>
            </select>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Link
              to="/tickets"
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
            >
              ยกเลิก
            </Link>
            <button
              type="submit"
              className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700"
            >
              ส่งคำร้อง
            </button>
          </div>
        </Form>
      </div>
    </div>
  );
}
