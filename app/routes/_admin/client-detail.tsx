import { Form, redirect } from "react-router";
import { requireAdmin, startImpersonation } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";

export function meta() {
  return [{ title: "รายละเอียดลูกค้า — Admin" }];
}

export async function loader({ request, params, context }: any) {
  const env = context.cloudflare.env;
  await requireAdmin(request, env.DB, env.SESSIONPORTAL);
  const db = createDB(env.DB);

  const client = await db.getClientById(params.clientId);
  if (!client) throw new Response("Not Found", { status: 404 });

  const user = await db.getUserById(client.user_id);
  const [reports, tickets] = await Promise.all([
    db.listReportsByClient(client.id),
    db.listTicketsByClient(client.id),
  ]);

  return { client, user, reportsCount: reports.length, ticketsCount: tickets.length };
}

export async function action({ request, params, context }: any) {
  const env = context.cloudflare.env;
  const admin = await requireAdmin(request, env.DB, env.SESSIONPORTAL);
  const db = createDB(env.DB);
  const client = await db.getClientById(params.clientId);
  if (!client) throw new Response("Not Found", { status: 404 });

  const sessionCookie = await startImpersonation(
    request,
    env.DB,
    env.SESSIONPORTAL,
    client.user_id,
    admin.id
  );

  return redirect("/dashboard", {
    headers: { "Set-Cookie": sessionCookie.serialize() },
  });
}

export default function AdminClientDetailPage({ loaderData }: any) {
  const { client, user, reportsCount, ticketsCount } = loaderData;

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{client.company_name}</h1>
          <p className="text-sm text-slate-500 mt-1">รายละเอียดลูกค้า</p>
        </div>
        <a href="/admin/clients" className="text-sm text-slate-500 hover:text-slate-900">
          ← กลับไปหน้าลูกค้า
        </a>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
        <div>
          <p className="text-xs text-slate-400">อีเมลผู้ใช้</p>
          <p className="text-sm text-slate-800">{user?.email ?? "-"}</p>
        </div>
        <div>
          <p className="text-xs text-slate-400">เว็บไซต์</p>
          <p className="text-sm text-slate-800">{client.website_url ?? "-"}</p>
        </div>
        <div>
          <p className="text-xs text-slate-400">แพ็กเกจ</p>
          <p className="text-sm text-slate-800">{client.package}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-xs text-slate-400">รายงานทั้งหมด</p>
          <p className="text-2xl font-semibold text-slate-900 mt-1">{reportsCount}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-xs text-slate-400">ทิคเก็ตทั้งหมด</p>
          <p className="text-2xl font-semibold text-slate-900 mt-1">{ticketsCount}</p>
        </div>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
        <p className="text-sm text-amber-900 font-medium">Impersonate client</p>
        <p className="text-xs text-amber-800 mt-1">
          เข้าระบบเป็นลูกค้าคนนี้เพื่อช่วยตรวจสอบปัญหาในมุมมองลูกค้า
        </p>
        <Form method="post" className="mt-3">
          <button
            type="submit"
            className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600"
          >
            เข้าดูในมุมมองลูกค้า
          </button>
        </Form>
      </div>
    </div>
  );
}
