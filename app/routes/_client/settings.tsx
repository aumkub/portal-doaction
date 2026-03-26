import { Form, redirect } from "react-router";
import { z } from "zod";
import { requireUser } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";
import PageHeader from "~/components/layout/PageHeader";

export function meta() {
  return [{ title: "Settings — DoAction Portal" }];
}

const ProfileSchema = z.object({
  name: z.string().min(1, "กรุณากรอกชื่อ"),
});

export async function loader({ request, context }: any) {
  const env = context.cloudflare.env;
  const user = await requireUser(request, env.DB, env.SESSIONPORTAL);
  const db = createDB(env.DB);
  const client = await db.getClientByUserId(user.id);
  return { user, client };
}

export async function action({ request, context }: any) {
  const env = context.cloudflare.env;
  const user = await requireUser(request, env.DB, env.SESSIONPORTAL);
  const db = createDB(env.DB);

  const formData = await request.formData();
  const raw = Object.fromEntries(formData);
  const parsed = ProfileSchema.safeParse(raw);

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  await db.updateUser(user.id, { name: parsed.data.name });
  return redirect("/settings");
}

export default function ClientSettingsPage({ loaderData, actionData }: any) {
  const { user, client } = loaderData;
  const errors = actionData?.errors;

  return (
    <div className="space-y-6 max-w-2xl">
      <PageHeader
        title="Settings"
        subtitle="ตั้งค่าบัญชีของคุณ"
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Settings" },
        ]}
      />

      {/* Profile */}
      <section className="bg-white rounded-xl border border-slate-200 p-6 space-y-5">
        <h2 className="text-sm font-semibold text-slate-900">ข้อมูลโปรไฟล์</h2>
        <Form method="post" className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-600">ชื่อ</label>
              <input
                name="name"
                defaultValue={user.name}
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
                value={user.email}
                readOnly
                className="w-full h-10 rounded-lg border border-slate-200 px-3 text-sm bg-slate-50 text-slate-400 cursor-not-allowed"
              />
              <p className="text-xs text-slate-400">
                อีเมลไม่สามารถเปลี่ยนได้ กรุณาติดต่อทีมงาน
              </p>
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

      {/* Company info — read only */}
      {client && (
        <section className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
          <h2 className="text-sm font-semibold text-slate-900">ข้อมูลบริษัท</h2>
          <div className="grid sm:grid-cols-2 gap-4 text-sm">
            <InfoRow label="ชื่อบริษัท" value={client.company_name} />
            <InfoRow
              label="แพ็กเกจ"
              value={
                client.package === "premium"
                  ? "Premium"
                  : client.package === "standard"
                  ? "Standard"
                  : "Basic"
              }
            />
            {client.website_url && (
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-slate-400">เว็บไซต์</span>
                <a
                  href={client.website_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-violet-600 hover:underline truncate"
                >
                  {client.website_url.replace(/^https?:\/\//, "")}
                </a>
              </div>
            )}
            {client.contract_end && (
              <InfoRow label="สิ้นสุดสัญญา" value={client.contract_end} />
            )}
          </div>
          <p className="text-xs text-slate-400 pt-2 border-t border-slate-100">
            หากต้องการแก้ไขข้อมูลบริษัท กรุณาติดต่อทีมงาน DoAction
          </p>
        </section>
      )}

      {/* Support */}
      <section className="bg-white rounded-xl border border-slate-200 p-6 space-y-3">
        <h2 className="text-sm font-semibold text-slate-900">ต้องการความช่วยเหลือ?</h2>
        <div className="flex flex-col gap-2">
          <a
            href="/tickets/new"
            className="inline-flex items-center gap-2 text-sm text-violet-600 hover:text-violet-700 font-medium"
          >
            🎫 แจ้งปัญหาผ่าน Support Ticket
          </a>
          <a
            href="mailto:support@doaction.co.th"
            className="inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900"
          >
            📧 support@doaction.co.th
          </a>
        </div>
      </section>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-slate-400">{label}</span>
      <span className="text-slate-700 font-medium">{value}</span>
    </div>
  );
}
