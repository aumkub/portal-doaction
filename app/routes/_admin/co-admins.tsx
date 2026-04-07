import { Form, redirect, useActionData } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/co-admins";
import { requireAdmin, hashPassword, startImpersonation } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";
import { generateId } from "~/lib/utils";
import { useT } from "~/lib/i18n";
import { sendTelegramNotificationToGroup } from "~/lib/telegram.server";
import { FaCirclePlus, FaTrash, FaUserSecret, FaTelegram, FaUserCheck, FaPaperPlane } from "react-icons/fa6";
import PageHeader from "~/components/layout/PageHeader";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Button } from "~/components/ui/button";

export function meta() {
  return [{ title: "จัดการ Co-Admin — Admin" }];
}

const CreateSchema = z.object({
  name: z.string().min(1, "กรุณาระบุชื่อ"),
  email: z.string().email("รูปแบบอีเมลไม่ถูกต้อง"),
  password: z.string().min(6, "รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร"),
  intent: z.literal("create"),
});

const AssignSchema = z.object({
  co_admin_id: z.string().min(1, "กรุณาระบุ Co-Admin"),
  client_id: z.string().min(1, "กรุณาระบุลูกค้า"),
  telegram_group_id: z.string().optional(),
  intent: z.literal("assign"),
});

const UnassignSchema = z.object({
  co_admin_id: z.string().min(1, "กรุณาระบุ Co-Admin"),
  client_id: z.string().min(1, "กรุณาระบุลูกค้า"),
  intent: z.literal("unassign"),
});

const DeleteSchema = z.object({
  co_admin_id: z.string().min(1),
  intent: z.literal("delete"),
});

const ImpersonateSchema = z.object({
  co_admin_id: z.string().min(1),
  intent: z.literal("impersonate"),
});

const UpdateTelegramSchema = z.object({
  co_admin_id: z.string().min(1, "กรุณาระบุ Co-Admin"),
  client_id: z.string().min(1, "กรุณาระบุลูกค้า"),
  telegram_group_id: z.string().optional(),
  intent: z.literal("update_telegram"),
});

const TestFireSchema = z.object({
  co_admin_id: z.string().min(1, "กรุณาระบุ Co-Admin"),
  client_id: z.string().min(1, "กรุณาระบุลูกค้า"),
  intent: z.literal("test_fire"),
});

export async function loader({ request, context }: Route.LoaderArgs) {
  await requireAdmin(request, context.cloudflare.env.DB, context.cloudflare.env.SESSIONPORTAL);
  const db = createDB(context.cloudflare.env.DB);
  const [coAdmins, clients] = await Promise.all([
    db.listCoAdminUsers(),
    db.listClients(),
  ]);

  // Get assigned clients for each co-admin
  const coAdminsWithClients = await Promise.all(
    coAdmins.map(async (coAdmin) => {
      const assignments = await db.listCoAdminClients(coAdmin.id);
      const assignedClientIds = assignments.map((a) => a.client_id);
      const assignedClients = clients.filter((c) => assignedClientIds.includes(c.id));
      // Map telegram_group_id to each assigned client
      const clientsWithTelegram = assignedClients.map((client) => ({
        ...client,
        telegram_group_id: assignments.find((a) => a.client_id === client.id)?.telegram_group_id ?? null,
      }));
      return {
        ...coAdmin,
        assigned_client_ids: assignedClientIds,
        assigned_clients: clientsWithTelegram,
      };
    })
  );

  return { coAdmins: coAdminsWithClients, clients };
}

export async function action({ request, context }: Route.ActionArgs) {
  await requireAdmin(request, context.cloudflare.env.DB, context.cloudflare.env.SESSIONPORTAL);
  const env = context.cloudflare.env;
  const db = createDB(env.DB);
  const formData = await request.formData();
  const raw = Object.fromEntries(formData);
  const intent = formData.get("intent");

  if (intent === "create") {
    const parsed = CreateSchema.safeParse(raw);
    if (!parsed.success) {
      return { errors: parsed.error.flatten().fieldErrors };
    }

    const { name, email, password } = parsed.data;

    // Check if email already exists
    const existing = await db.getUserByEmail(email);
    if (existing) {
      return { errors: { email: ["อีเมลนี้ถูกใช้งานแล้ว"] } };
    }

    // Create co-admin with password
    const passwordHash = await hashPassword(password);
    const coAdminId = generateId();
    await db.createUser({
      id: coAdminId,
      email,
      name,
      role: "co-admin",
      password_hash: passwordHash,
      avatar_url: null,
    });

    return redirect("/admin/co-admins");
  }

  if (intent === "assign") {
    const parsed = AssignSchema.safeParse(raw);
    if (!parsed.success) {
      return { errors: parsed.error.flatten().fieldErrors };
    }

    const { co_admin_id, client_id, telegram_group_id } = parsed.data;
    await db.addCoAdminClient(co_admin_id, client_id, telegram_group_id || null);

    return { success: { assigned: true } };
  }

  if (intent === "unassign") {
    const parsed = UnassignSchema.safeParse(raw);
    if (!parsed.success) {
      return { errors: parsed.error.flatten().fieldErrors };
    }

    const { co_admin_id, client_id } = parsed.data;
    await db.removeCoAdminClient(co_admin_id, client_id);

    return { success: { unassigned: true } };
  }

  if (intent === "update_telegram") {
    const parsed = UpdateTelegramSchema.safeParse(raw);
    if (!parsed.success) {
      return { errors: parsed.error.flatten().fieldErrors };
    }

    const { co_admin_id, client_id, telegram_group_id } = parsed.data;
    await db.updateCoAdminClientTelegramGroup(co_admin_id, client_id, telegram_group_id || null);

    return { success: { telegram_updated: true } };
  }

  if (intent === "test_fire") {
    const parsed = TestFireSchema.safeParse(raw);
    if (!parsed.success) {
      return { errors: parsed.error.flatten().fieldErrors };
    }

    const { co_admin_id, client_id } = parsed.data;

    // Get the co-admin client assignment to check if telegram_group_id is set
    const assignments = await db.listCoAdminClients(co_admin_id);
    const assignment = assignments.find((a) => a.client_id === client_id);

    if (!assignment || !assignment.telegram_group_id) {
      return { errors: { general: ["กรุณาระบุ Telegram Group ID ก่อนทดสอบ"] } };
    }

    // Get client info for the notification
    const client = await db.getClientById(client_id);
    if (!client) {
      return { errors: { general: ["ไม่พบข้อมูลลูกค้า"] } };
    }

    // Send test notification to Co-Admin's specific Telegram group
    const testNotification = {
      id: generateId(),
      user_id: co_admin_id,
      type: "ticket_update" as const,
      title: "🧪 ทดสอบการแจ้งเตือน",
      body: `ทดสอบการส่งการแจ้งเตือนสำหรับลูกค้า: ${client.company_name}\n\nTelegram Group ID: ${assignment.telegram_group_id}`,
      link: `/admin/clients/${client_id}`,
      read: 0,
    } as const;

    try {
      // Send test notification ONLY to this specific Co-Admin's Telegram group
      await sendTelegramNotificationToGroup({
        db,
        appUrl: env.APP_URL,
        notification: testNotification,
        telegramGroupId: assignment.telegram_group_id,
      });
    } catch (error) {
      console.error("Test notification failed:", error);
      return { errors: { general: ["ส่งการแจ้งเตือนไม่สำเร็จ กรุณาตรวจสอบ Telegram Group ID"] } };
    }

    return { success: { test_fire: true } };
  }

  if (intent === "impersonate") {
    const parsed = ImpersonateSchema.safeParse(raw);
    if (!parsed.success) {
      return { errors: parsed.error.flatten().fieldErrors };
    }

    const { co_admin_id } = parsed.data;
    const coAdmin = await db.getUserById(co_admin_id);
    if (!coAdmin) {
      return { errors: { co_admin_id: ["Co-Admin not found"] } };
    }

    // Start impersonation as the co-admin
    const sessionCookie = await startImpersonation(
      request,
      env.DB,
      env.SESSIONPORTAL,
      coAdmin.id,
      (await requireAdmin(request, env.DB, env.SESSIONPORTAL)).id
    );

    return redirect("/admin", {
      headers: { "Set-Cookie": sessionCookie.serialize() },
    });
  }

  if (intent === "delete") {
    const parsed = DeleteSchema.safeParse(raw);
    if (!parsed.success) {
      return { errors: parsed.error.flatten().fieldErrors };
    }

    const { co_admin_id } = parsed.data;
    // Remove all client assignments first
    await db.removeAllCoAdminAssignments(co_admin_id);
    // Note: We don't delete the user, just unassign. Use a different action to actually delete.

    return redirect("/admin/co-admins");
  }

  return { errors: { general: ["Invalid intent"] } };
}

export default function CoAdminsPage({ loaderData, actionData }: Route.ComponentProps) {
  const { coAdmins, clients } = loaderData;
  const { t } = useT();
  const errors = actionData?.errors;
  const success = actionData?.success;

  return (
    <div className="space-y-6 max-w-5xl">
      <PageHeader
        title="จัดการ Co-Admin"
        subtitle={`จัดการผู้ดูแลระบบระดับ Co-Admin (${coAdmins.length})`}
        breadcrumbs={[
          { label: "Admin" },
          { label: "Co-Admins" },
        ]}
      />

      {/* Create new co-admin */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-5">
        <h2 className="text-sm font-semibold text-slate-900">เพิ่ม Co-Admin ใหม่</h2>
        <Form method="post" className="grid sm:grid-cols-4 gap-4 items-end">
          <input type="hidden" name="intent" value="create" />
          <div className="space-y-1.5">
            <Label htmlFor="create-name">ชื่อ</Label>
            <Input
              id="create-name"
              name="name"
              type="text"
              required
              placeholder="ชื่อผู้ใช้"
            />
            {errors?.name && <p className="text-xs text-red-500 mt-1">{errors.name[0]}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="create-email">อีเมล</Label>
            <Input
              id="create-email"
              name="email"
              type="email"
              required
              placeholder="email@example.com"
            />
            {errors?.email && <p className="text-xs text-red-500 mt-1">{errors.email[0]}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="create-password">รหัสผ่าน</Label>
            <Input
              id="create-password"
              name="password"
              type="password"
              required
              minLength={6}
              placeholder="••••••"
            />
            {errors?.password && <p className="text-xs text-red-500 mt-1">{errors.password[0]}</p>}
          </div>
          <Button
            type="submit"
            className="bg-violet-600 hover:bg-violet-700 text-white"
          >
            <FaCirclePlus aria-hidden="true" className="mr-2" />
            เพิ่ม Co-Admin
          </Button>
        </Form>
        {success?.assigned && (
          <p className="text-xs text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
            ✓ เพิ่ม Co-Admin ใหม่เรียบร้อยแล้ว
          </p>
        )}
        {success?.test_fire && (
          <p className="text-xs text-blue-600 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
            ✓ ส่งการแจ้งเตือนทดสอบเรียบร้อยแล้ว
          </p>
        )}
      </div>

      {/* Co-admins list */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {coAdmins.length === 0 ? (
          <div className="p-12 text-center text-slate-400">
            ยังไม่มี Co-Admin
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {coAdmins.map((coAdmin) => (
              <div key={coAdmin.id} className="p-6 space-y-5">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center">
                      <FaUserSecret className="text-emerald-600" />
                    </div>
                    <div>
                      <h3 className="text-sm font-medium text-slate-900">{coAdmin.name}</h3>
                      <p className="text-xs text-slate-500">{coAdmin.email}</p>
                    </div>
                    <span className="text-xs text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-full font-medium">
                      Co-Admin
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Form method="post">
                      <input type="hidden" name="intent" value="impersonate" />
                      <input type="hidden" name="co_admin_id" value={coAdmin.id} />
                      <Button
                        type="submit"
                        variant="outline"
                        size="sm"
                        className="text-emerald-600 border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700"
                        onClick={(e) => {
                          if (!confirm(`คุณต้องการจำลองบทบาทเป็น Co-Admin "${coAdmin.name}"?`)) {
                            e.preventDefault();
                          }
                        }}
                      >
                        <FaUserCheck aria-hidden="true" className="mr-1.5" />
                        จำลองบทบาท
                      </Button>
                    </Form>
                    <Form method="post">
                      <input type="hidden" name="intent" value="delete" />
                      <input type="hidden" name="co_admin_id" value={coAdmin.id} />
                      <Button
                      type="submit"
                      variant="ghost"
                      size="sm"
                      className="text-red-600 hover:text-red-700 hover:bg-red-50"
                      onClick={(e) => {
                        if (!confirm("คุณแน่ใจหรือไม่ที่จะลบ Co-Admin นี้?")) {
                          e.preventDefault();
                        }
                      }}
                    >
                      <FaTrash aria-hidden="true" className="mr-1.5" />
                      ลบ
                    </Button>
                  </Form>
                </div>
                </div>

                {/* Assigned clients */}
                <div className="pl-13 space-y-4">
                  <div>
                    <h4 className="text-xs font-medium text-slate-700 mb-3">
                      ลูกค้าที่ดูแล ({coAdmin.assigned_clients.length})
                    </h4>
                    <Form method="post" className="flex items-center gap-2">
                      <input type="hidden" name="intent" value="assign" />
                      <input type="hidden" name="co_admin_id" value={coAdmin.id} />
                      <select
                        name="client_id"
                        required
                        className="h-9 text-xs border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-slate-900"
                      >
                        <option value="">เพิ่มลูกค้า...</option>
                        {clients
                          .filter((c) => !coAdmin.assigned_client_ids.includes(c.id))
                          .map((client) => (
                            <option key={client.id} value={client.id}>
                              {client.company_name}
                            </option>
                          ))}
                      </select>
                      <Input
                        type="text"
                        name="telegram_group_id"
                        placeholder="Telegram Group ID"
                        className="h-9 text-xs flex-1"
                      />
                      <Button
                        type="submit"
                        size="sm"
                        className="bg-slate-900 hover:bg-slate-700"
                      >
                        เพิ่ม
                      </Button>
                    </Form>
                  </div>
                  {coAdmin.assigned_clients.length === 0 ? (
                    <p className="text-xs text-slate-400 italic py-2">ยังไม่ได้รับมอบหมายลูกค้า</p>
                  ) : (
                    <div className="space-y-2">
                      {coAdmin.assigned_clients.map((client) => (
                        <div
                          key={client.id}
                          className="flex items-start gap-3 p-3 bg-slate-50 rounded-lg border border-slate-100"
                        >
                          <div className="flex-1 min-w-0 space-y-2">
                            <div className="flex items-center justify-between">
                              <p className="text-sm font-medium text-slate-700">{client.company_name}</p>
                              {client.telegram_group_id && (
                                <div className="flex items-center gap-1.5 text-xs text-blue-600">
                                  <FaTelegram className="flex-shrink-0" />
                                  <span className="truncate max-w-[200px]" title={client.telegram_group_id}>
                                    {client.telegram_group_id}
                                  </span>
                                </div>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <Form method="post" className="flex items-center gap-2 flex-1">
                                <input type="hidden" name="intent" value="update_telegram" />
                                <input type="hidden" name="co_admin_id" value={coAdmin.id} />
                                <input type="hidden" name="client_id" value={client.id} />
                                <Input
                                  type="text"
                                  name="telegram_group_id"
                                  placeholder="Telegram Group ID"
                                  defaultValue={client.telegram_group_id ?? ""}
                                  className="h-8 text-xs flex-1"
                                />
                                <Button
                                  type="submit"
                                  size="sm"
                                  variant="outline"
                                  className="h-8 text-xs"
                                >
                                  บันทึก
                                </Button>
                              </Form>
                              {client.telegram_group_id && (
                                <Form method="post">
                                  <input type="hidden" name="intent" value="test_fire" />
                                  <input type="hidden" name="co_admin_id" value={coAdmin.id} />
                                  <input type="hidden" name="client_id" value={client.id} />
                                  <Button
                                    type="submit"
                                    size="sm"
                                    variant="ghost"
                                    className="h-8 text-xs text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                                    onClick={(e) => {
                                      if (!confirm(`ทดสอบส่งการแจ้งเตือนไปยัง Telegram Group สำหรับ ${client.company_name}?`)) {
                                        e.preventDefault();
                                      }
                                    }}
                                  >
                                    <FaPaperPlane className="mr-1" />
                                    ทดสอบ
                                  </Button>
                                </Form>
                              )}
                            </div>
                          </div>
                          <Form method="post">
                            <input type="hidden" name="intent" value="unassign" />
                            <input type="hidden" name="co_admin_id" value={coAdmin.id} />
                            <input type="hidden" name="client_id" value={client.id} />
                            <Button
                              type="submit"
                              variant="ghost"
                              size="sm"
                              className="text-red-600 hover:text-red-700 hover:bg-red-50 h-8"
                              onClick={(e) => {
                                if (!confirm(`ลบการมอบหมายลูกค้า ${client.company_name}?`)) {
                                  e.preventDefault();
                                }
                              }}
                            >
                              <FaTrash aria-hidden="true" className="mr-1" />
                              ลบ
                            </Button>
                          </Form>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Info box */}
      <div className="bg-violet-50 border border-violet-100 rounded-xl p-6 space-y-3">
        <div className="flex items-center gap-2">
          <svg className="w-5 h-5 text-violet-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <h3 className="text-sm font-semibold text-violet-900">ข้อมูลเพิ่มเติม</h3>
        </div>
        <ul className="text-xs text-violet-800 space-y-1.5 list-disc list-inside">
          <li>Co-Admins สามารถดูข้อมูลเฉพาะลูกค้าที่ได้รับมอบหมายเท่านั้น</li>
          <li>Co-Admins สามารถตอบทิกเก็ตได้ แต่อ่านรายงานแบบ Read-Only</li>
          <li>Co-Admins ไม่สามารถเข้าถึง Settings, Email Logs, และ Attachments</li>
          <li>Co-Admins ต้องใช้รหัสผ่านในการเข้าสู่ระบบ (ไม่รองรับ Magic Link)</li>
          <li>สามารถตั้งค่า Telegram Group ID สำหรับแต่ละลูกค้าเพื่อรับการแจ้งเตือนเฉพาะกลุ่ม</li>
        </ul>
      </div>
    </div>
  );
}
