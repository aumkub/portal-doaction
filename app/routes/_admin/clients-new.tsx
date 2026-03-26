import { redirect, Form } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/clients-new";
import { generateId } from "~/lib/utils";
import PageHeader from "~/components/layout/PageHeader";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Button } from "~/components/ui/button";

export function meta() {
  return [{ title: "เพิ่มลูกค้าใหม่ — Admin" }];
}

const Schema = z.object({
  name:            z.string().min(1, "กรุณาระบุชื่อ"),
  email:           z.string().email("อีเมลไม่ถูกต้อง"),
  company_name:    z.string().min(1, "กรุณาระบุชื่อบริษัท"),
  website_url:     z.string().url("URL ไม่ถูกต้อง").optional().or(z.literal("")),
  package:         z.enum(["basic", "standard", "premium"]),
  contract_start:  z.string().optional(),
  contract_end:    z.string().optional(),
  notes:           z.string().optional(),
  send_invite:     z.coerce.boolean().default(true),
});

export async function loader({ request, context }: Route.LoaderArgs) {
  const { requireAdmin } = await import("~/lib/auth.server");
  await requireAdmin(request, context.cloudflare.env.DB, context.cloudflare.env.SESSIONPORTAL);
  return null;
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const { requireAdmin, generateMagicToken } = await import("~/lib/auth.server");
  const { createDB } = await import("~/lib/db.server");
  const { sendMagicLinkEmail } = await import("~/lib/email.server");
  await requireAdmin(request, env.DB, env.SESSIONPORTAL);
  const db = createDB(env.DB);

  const parsed = Schema.safeParse(Object.fromEntries(await request.formData()));
  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const { name, email, company_name, website_url, package: pkg,
          contract_start, contract_end, notes, send_invite } = parsed.data;

  // Check existing email
  const existing = await db.getUserByEmail(email);
  if (existing) return { errors: { email: ["อีเมลนี้มีในระบบแล้ว"] } };

  const userId = generateId();
  const clientId = generateId();

  await db.createUser({ id: userId, email, name, role: "client", avatar_url: null });
  await db.createClient({
    id: clientId,
    user_id: userId,
    company_name,
    website_url: website_url || null,
    package: pkg,
    contract_start: contract_start || null,
    contract_end: contract_end || null,
    notes: notes || null,
  });

  // Send magic-link invite email
  if (send_invite) {
    try {
      const { id, token, expires_at } = generateMagicToken();
      await db.createMagicLinkToken({ id, user_id: userId, token, expires_at, used: 0 });
      const origin = env.APP_URL || new URL(request.url).origin;
      await sendMagicLinkEmail({
        to: email,
        toName: name,
        magicUrl: `${origin}/magic-link?token=${token}`,
        apiKey: env.SMTP2GO_API_KEY,
      });
    } catch (err) {
      console.error("[clients-new] invite email failed:", err);
    }
  }

  return redirect(`/admin/clients`);
}

export default function AdminClientsNewPage({ actionData }: Route.ComponentProps) {
  const errors = (actionData as { errors?: Record<string, string[]> })?.errors;

  return (
    <div className="space-y-6 max-w-2xl">
      <PageHeader
        title="เพิ่มลูกค้าใหม่"
        breadcrumbs={[
          { label: "Admin", href: "/admin/clients" },
          { label: "ลูกค้า", href: "/admin/clients" },
          { label: "ใหม่" },
        ]}
      />

      <Form method="post" className="space-y-6">
        <section className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
          <h2 className="text-sm font-semibold text-slate-900">ข้อมูลผู้ติดต่อ</h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="name">ชื่อ-นามสกุล</Label>
              <Input id="name" name="name" placeholder="สมชาย ใจดี" required />
              {errors?.name && <p className="text-red-500 text-xs">{errors.name[0]}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">อีเมล</Label>
              <Input id="email" name="email" type="email" placeholder="client@example.com" required />
              {errors?.email && <p className="text-red-500 text-xs">{errors.email[0]}</p>}
            </div>
          </div>
        </section>

        <section className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
          <h2 className="text-sm font-semibold text-slate-900">ข้อมูลบริษัท</h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5 col-span-2">
              <Label htmlFor="company_name">ชื่อบริษัท</Label>
              <Input id="company_name" name="company_name" placeholder="บริษัท ตัวอย่าง จำกัด" required />
              {errors?.company_name && <p className="text-red-500 text-xs">{errors.company_name[0]}</p>}
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label htmlFor="website_url">Website URL</Label>
              <Input id="website_url" name="website_url" type="url" placeholder="https://example.com" />
              {errors?.website_url && <p className="text-red-500 text-xs">{errors.website_url[0]}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="package">แพ็กเกจ</Label>
              <select id="package" name="package" defaultValue="standard"
                className="w-full h-10 rounded-lg border border-slate-200 px-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-900">
                <option value="basic">Basic</option>
                <option value="standard">Standard</option>
                <option value="premium">Premium</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="contract_start">วันเริ่มสัญญา</Label>
              <Input id="contract_start" name="contract_start" type="date" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="contract_end">วันสิ้นสุดสัญญา</Label>
              <Input id="contract_end" name="contract_end" type="date" />
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label htmlFor="notes">หมายเหตุ</Label>
              <textarea id="notes" name="notes" rows={2}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 resize-none" />
            </div>
          </div>
        </section>

        <div className="flex items-center gap-3 bg-white rounded-xl border border-slate-200 px-5 py-4">
          <input id="send_invite" name="send_invite" type="checkbox" defaultChecked
            className="rounded accent-violet-600" />
          <label htmlFor="send_invite" className="text-sm text-slate-700">
            ส่ง Magic Link อีเมลเชิญลูกค้าเข้าระบบทันที
          </label>
        </div>

        <div className="flex justify-end gap-3">
          <a href="/admin/clients"
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 transition-colors">
            ยกเลิก
          </a>
          <Button type="submit" className="bg-violet-600 hover:bg-violet-700 text-white">
            สร้างลูกค้า
          </Button>
        </div>
      </Form>
    </div>
  );
}
