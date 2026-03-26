import { Form, redirect } from "react-router";
import { z } from "zod";
import { requireAdmin } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";
import PageHeader from "~/components/layout/PageHeader";

export function meta() {
  return [{ title: "Settings — Admin" }];
}

const ProfileSchema = z.object({
  name: z.string().min(1, "Name is required"),
  intent: z.literal("profile"),
});

export async function loader({ request, context }: any) {
  const env = context.cloudflare.env;
  const admin = await requireAdmin(request, env.DB, env.SESSIONPORTAL);
  const db = createDB(env.DB);
  const adminUsers = await db.listAdminUsers();
  const uptimeKey =
    (env as any).UPTIMEROBOT_API_KEY ?? "ur2618139-5281beb51ff9820a629669c2";
  return { admin, adminUsers, uptimeKey };
}

export async function action({ request, context }: any) {
  const env = context.cloudflare.env;
  const admin = await requireAdmin(request, env.DB, env.SESSIONPORTAL);
  const db = createDB(env.DB);

  const formData = await request.formData();
  const raw = Object.fromEntries(formData);
  const parsed = ProfileSchema.safeParse(raw);

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  await db.updateUser(admin.id, { name: parsed.data.name });
  return redirect("/admin/settings");
}

export default function AdminSettingsPage({ loaderData, actionData }: any) {
  const { admin, adminUsers, uptimeKey } = loaderData;
  const errors = actionData?.errors;

  const maskedKey =
    uptimeKey.length > 12
      ? `${uptimeKey.slice(0, 6)}${"•".repeat(uptimeKey.length - 12)}${uptimeKey.slice(-6)}`
      : "•".repeat(uptimeKey.length);

  return (
    <div className="space-y-6 max-w-3xl">
      <PageHeader
        title="Settings"
        subtitle="ตั้งค่าระบบและบัญชีผู้ดูแล"
        breadcrumbs={[{ label: "Admin" }, { label: "Settings" }]}
      />

      {/* Profile */}
      <section className="bg-white rounded-xl border border-slate-200 p-6 space-y-5">
        <h2 className="text-sm font-semibold text-slate-900">บัญชีของฉัน</h2>
        <Form method="post" className="space-y-4">
          <input type="hidden" name="intent" value="profile" />
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-600">ชื่อ</label>
              <input
                name="name"
                defaultValue={admin.name}
                required
                className="w-full h-10 rounded-lg border border-slate-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
              {errors?.name && (
                <p className="text-xs text-red-500">{errors.name[0]}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-600">อีเมล</label>
              <input
                value={admin.email}
                readOnly
                className="w-full h-10 rounded-lg border border-slate-200 px-3 text-sm bg-slate-50 text-slate-400 cursor-not-allowed"
              />
            </div>
          </div>
          <div className="flex justify-end">
            <button
              type="submit"
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 transition-colors"
            >
              บันทึก
            </button>
          </div>
        </Form>
      </section>

      {/* Admin team */}
      <section className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
        <h2 className="text-sm font-semibold text-slate-900">
          ทีม Admin ({adminUsers.length})
        </h2>
        <ul className="divide-y divide-slate-100">
          {adminUsers.map((u: any) => (
            <li key={u.id} className="flex items-center justify-between py-3">
              <div>
                <p className="text-sm font-medium text-slate-800">{u.name}</p>
                <p className="text-xs text-slate-400">{u.email}</p>
              </div>
              {u.id === admin.id && (
                <span className="text-xs text-slate-400">(คุณ)</span>
              )}
            </li>
          ))}
        </ul>
      </section>

      {/* Integrations */}
      <section className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
        <h2 className="text-sm font-semibold text-slate-900">Integrations</h2>
        <div className="rounded-lg border border-slate-100 bg-slate-50 p-4 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-base">🟢</span>
            <p className="text-sm font-medium text-slate-800">UptimeRobot</p>
            <span className="ml-auto text-xs text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full font-medium">
              Connected
            </span>
          </div>
          <p className="text-xs text-slate-500">
            ดึงข้อมูล Uptime อัตโนมัติโดยจับคู่กับ domain ของลูกค้า
          </p>
          <div className="flex items-center gap-2 mt-2">
            <span className="text-xs text-slate-400 font-mono bg-white border border-slate-200 rounded px-2 py-1 select-all">
              {maskedKey}
            </span>
            <span className="text-xs text-slate-400">Read-only API key</span>
          </div>
        </div>
      </section>

      {/* Portal info */}
      <section className="bg-white rounded-xl border border-slate-200 p-6 space-y-3">
        <h2 className="text-sm font-semibold text-slate-900">Portal Info</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          <InfoRow label="Platform" value="Cloudflare Workers + D1" />
          <InfoRow label="Support Email" value="support@doaction.co.th" />
          <InfoRow label="Portal Version" value="1.0.0" />
        </div>
      </section>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-slate-400">{label}</span>
      <span className="text-sm text-slate-700 font-medium">{value}</span>
    </div>
  );
}
