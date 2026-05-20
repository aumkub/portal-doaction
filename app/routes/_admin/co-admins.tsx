import { Form, redirect, useActionData } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/co-admins";
import { requireAdmin, hashPassword, startImpersonation } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";
import { generateId } from "~/lib/utils";
import { useT } from "~/lib/i18n";
import { sendTelegramNotification, sendTelegramNotificationToGroup } from "~/lib/telegram.server";
import {
  FaCirclePlus,
  FaTrash,
  FaUserSecret,
  FaTelegram,
  FaUserCheck,
  FaPaperPlane,
  FaCircleCheck,
  FaKey,
  FaUsers,
  FaChevronDown,
  FaPlus,
} from "react-icons/fa6";
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
  co_admin_id: z.string().min(1),
  client_id: z.string().min(1),
  telegram_group_id: z.string().optional(),
  intent: z.literal("assign"),
});

const UnassignSchema = z.object({
  co_admin_id: z.string().min(1),
  client_id: z.string().min(1),
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
  co_admin_id: z.string().min(1),
  client_id: z.string().min(1),
  telegram_group_id: z.string().optional(),
  intent: z.literal("update_telegram"),
});

const TestFireSchema = z.object({
  co_admin_id: z.string().min(1),
  client_id: z.string().min(1),
  intent: z.literal("test_fire"),
});

const ResetPasswordSchema = z.object({
  co_admin_id: z.string().min(1),
  new_password: z.string().min(6, "รหัสผ่านใหม่ต้องมีอย่างน้อย 6 ตัวอักษร"),
  intent: z.literal("reset_password"),
});

export async function loader({ request, context }: Route.LoaderArgs) {
  await requireAdmin(request, context.cloudflare.env.DB, context.cloudflare.env.SESSIONPORTAL);
  const db = createDB(context.cloudflare.env.DB);
  const [coAdmins, clients] = await Promise.all([db.listCoAdminUsers(), db.listClients()]);

  const coAdminsWithClients = await Promise.all(
    coAdmins.map(async (coAdmin) => {
      const assignments = await db.listCoAdminClients(coAdmin.id);
      const assignedClientIds = assignments.map((a) => a.client_id);
      const assignedClients = clients
        .filter((c) => assignedClientIds.includes(c.id))
        .map((client) => ({
          ...client,
          telegram_group_id: assignments.find((a) => a.client_id === client.id)?.telegram_group_id ?? null,
        }));
      return { ...coAdmin, assigned_client_ids: assignedClientIds, assigned_clients: assignedClients };
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
    if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };
    const { name, email, password } = parsed.data;
    const existing = await db.getUserByEmail(email);
    if (existing) return { errors: { email: ["อีเมลนี้ถูกใช้งานแล้ว"] } };
    const passwordHash = await hashPassword(password);
    await db.createUser({ id: generateId(), email, name, role: "co-admin", password_hash: passwordHash, avatar_url: null });
    return redirect("/admin/co-admins");
  }

  if (intent === "assign") {
    const parsed = AssignSchema.safeParse(raw);
    if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };
    const { co_admin_id, client_id, telegram_group_id } = parsed.data;
    await db.addCoAdminClient(co_admin_id, client_id, telegram_group_id || null);
    return { success: { assigned: true } };
  }

  if (intent === "unassign") {
    const parsed = UnassignSchema.safeParse(raw);
    if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };
    await db.removeCoAdminClient(parsed.data.co_admin_id, parsed.data.client_id);
    return { success: { unassigned: true } };
  }

  if (intent === "update_telegram") {
    const parsed = UpdateTelegramSchema.safeParse(raw);
    if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };
    const { co_admin_id, client_id, telegram_group_id } = parsed.data;
    await db.updateCoAdminClientTelegramGroup(co_admin_id, client_id, telegram_group_id || null);
    return { success: { telegram_updated: true } };
  }

  if (intent === "test_fire") {
    const parsed = TestFireSchema.safeParse(raw);
    if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };
    const { co_admin_id, client_id } = parsed.data;
    const client = await db.getClientById(client_id);
    if (!client) return { errors: { general: ["ไม่พบข้อมูลลูกค้า"] } };
    const assignments = await db.listCoAdminClients(co_admin_id);
    const assignment = assignments.find((a) => a.client_id === client_id);
    const testNotification = {
      id: generateId(),
      user_id: co_admin_id,
      type: "ticket_update" as const,
      title: "🧪 ทดสอบการแจ้งเตือน",
      body: `ทดสอบการส่งการแจ้งเตือนสำหรับลูกค้า: ${client.company_name}${
        assignment?.telegram_group_id
          ? `\nTelegram Group ID: ${assignment.telegram_group_id}`
          : "\n(ไม่ได้ระบุ Group ID เฉพาะ - ใช้การตั้งค่าทั่วไป)"
      }`,
      link: `/admin/clients/${client_id}`,
      read: 0,
    } as const;
    try {
      if (assignment?.telegram_group_id) {
        await sendTelegramNotificationToGroup({ db, appUrl: env.APP_URL, notification: testNotification, telegramGroupId: assignment.telegram_group_id });
      } else {
        await sendTelegramNotification({ db, appUrl: env.APP_URL, notification: testNotification });
      }
    } catch {
      return { errors: { general: ["ส่งการแจ้งเตือนไม่สำเร็จ"] } };
    }
    return { success: { test_fire: true } };
  }

  if (intent === "impersonate") {
    const parsed = ImpersonateSchema.safeParse(raw);
    if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };
    const coAdmin = await db.getUserById(parsed.data.co_admin_id);
    if (!coAdmin) return { errors: { co_admin_id: ["Co-Admin not found"] } };
    const currentAdmin = await requireAdmin(request, env.DB, env.SESSIONPORTAL);
    const sessionCookie = await startImpersonation(request, env.DB, env.SESSIONPORTAL, coAdmin.id, currentAdmin.id);
    return redirect("/admin", { headers: { "Set-Cookie": sessionCookie.serialize() } });
  }

  if (intent === "reset_password") {
    const parsed = ResetPasswordSchema.safeParse(raw);
    if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };
    const { co_admin_id, new_password } = parsed.data;
    const coAdmin = await db.getUserById(co_admin_id);
    if (!coAdmin || coAdmin.role !== "co-admin") return { errors: { co_admin_id: ["ไม่พบ Co-Admin"] } };
    await db.updateUserPasswordHash(co_admin_id, await hashPassword(new_password));
    return { success: { password_reset: true } };
  }

  if (intent === "delete") {
    const parsed = DeleteSchema.safeParse(raw);
    if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };
    await db.removeAllCoAdminAssignments(parsed.data.co_admin_id);
    return redirect("/admin/co-admins");
  }

  return { errors: { general: ["Invalid intent"] } };
}

function getInitials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

function avatarColor(name: string) {
  const colors = [
    "bg-violet-100 text-violet-700", "bg-blue-100 text-blue-700",
    "bg-emerald-100 text-emerald-700", "bg-orange-100 text-orange-700",
    "bg-rose-100 text-rose-700", "bg-indigo-100 text-indigo-700",
    "bg-teal-100 text-teal-700", "bg-pink-100 text-pink-700",
  ];
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) & 0xffff;
  return colors[hash % colors.length];
}

export default function CoAdminsPage({ loaderData, actionData }: Route.ComponentProps) {
  const { coAdmins, clients } = loaderData;
  const { t } = useT();
  const errors = actionData?.errors as Record<string, string[]> | undefined;
  const success = actionData?.success as Record<string, boolean> | undefined;

  const totalAssignments = coAdmins.reduce((sum, ca) => sum + ca.assigned_clients.length, 0);

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">จัดการ Co-Admin</h1>
          <p className="text-slate-500 text-sm mt-0.5">จัดการผู้ดูแลระบบและการมอบหมายลูกค้า</p>
        </div>
      </div>

      {/* ── Stats strip ── */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3.5 flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 shrink-0">
            <FaUserSecret className="text-sm" />
          </span>
          <div>
            <p className="text-xs text-slate-500">Co-Admin ทั้งหมด</p>
            <p className="text-xl font-semibold text-slate-900">{coAdmins.length}</p>
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3.5 flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600 shrink-0">
            <FaUsers className="text-sm" />
          </span>
          <div>
            <p className="text-xs text-slate-500">การมอบหมายทั้งหมด</p>
            <p className="text-xl font-semibold text-slate-900">{totalAssignments}</p>
          </div>
        </div>
      </div>

      {/* ── Create form ── */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-100">
          <FaCirclePlus className="text-violet-500 text-sm" />
          <p className="text-sm font-semibold text-slate-900">เพิ่ม Co-Admin ใหม่</p>
        </div>
        <div className="p-5">
          <Form method="post" className="grid sm:grid-cols-4 gap-4 items-end">
            <input type="hidden" name="intent" value="create" />
            <div className="space-y-1.5">
              <Label htmlFor="create-name">ชื่อ</Label>
              <Input id="create-name" name="name" type="text" required placeholder="ชื่อผู้ใช้" />
              {errors?.name && <p className="text-xs text-red-500">{errors.name[0]}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="create-email">อีเมล</Label>
              <Input id="create-email" name="email" type="email" required placeholder="email@example.com" />
              {errors?.email && <p className="text-xs text-red-500">{errors.email[0]}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="create-password">รหัสผ่าน</Label>
              <Input id="create-password" name="password" type="password" required minLength={6} placeholder="••••••" />
              {errors?.password && <p className="text-xs text-red-500">{errors.password[0]}</p>}
            </div>
            <Button type="submit" className="bg-violet-600 hover:bg-violet-700 text-white">
              <FaCirclePlus aria-hidden="true" />
              เพิ่ม Co-Admin
            </Button>
          </Form>

          {/* Success toasts */}
          {success?.password_reset && (
            <p className="mt-3 flex items-center gap-2 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
              <FaCircleCheck /> เปลี่ยนรหัสผ่าน Co-Admin เรียบร้อยแล้ว
            </p>
          )}
          {success?.test_fire && (
            <p className="mt-3 flex items-center gap-2 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
              <FaCircleCheck /> ส่งการแจ้งเตือนทดสอบเรียบร้อยแล้ว
            </p>
          )}
        </div>
      </div>

      {/* ── Co-admin cards ── */}
      {coAdmins.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-16 text-center">
          <FaUserSecret className="mx-auto text-3xl text-slate-200 mb-3" />
          <p className="text-sm text-slate-500">ยังไม่มี Co-Admin</p>
        </div>
      ) : (
        <div className="space-y-4">
          {coAdmins.map((coAdmin) => {
            const initials = getInitials(coAdmin.name);
            const avatarCls = avatarColor(coAdmin.name);
            const unassignedClients = clients.filter((c) => !coAdmin.assigned_client_ids.includes(c.id));
            return (
              <div key={coAdmin.id} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                {/* Card header */}
                <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between px-5 py-4 border-b border-slate-100">
                  <div className="flex items-center gap-3">
                    <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold ${avatarCls}`}>
                      {initials}
                    </span>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-slate-900">{coAdmin.name}</p>
                        <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full ring-1 ring-emerald-200">
                          CO-ADMIN
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">{coAdmin.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {/* Impersonate */}
                    <Form method="post">
                      <input type="hidden" name="intent" value="impersonate" />
                      <input type="hidden" name="co_admin_id" value={coAdmin.id} />
                      <button
                        type="submit"
                        onClick={(e) => { if (!confirm(`จำลองบทบาทเป็น "${coAdmin.name}"?`)) e.preventDefault(); }}
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 px-3 py-1.5 rounded-lg transition-colors"
                      >
                        <FaUserCheck className="text-[10px]" />
                        จำลองบทบาท
                      </button>
                    </Form>
                    {/* Delete */}
                    <Form method="post">
                      <input type="hidden" name="intent" value="delete" />
                      <input type="hidden" name="co_admin_id" value={coAdmin.id} />
                      <button
                        type="submit"
                        onClick={(e) => { if (!confirm("ลบ Co-Admin นี้?")) e.preventDefault(); }}
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-200 px-3 py-1.5 rounded-lg transition-colors"
                      >
                        <FaTrash className="text-[10px]" />
                        ลบ
                      </button>
                    </Form>
                  </div>
                </div>

                <div className="p-5 space-y-5">
                  {/* Reset password (collapsible) */}
                  <details className="group rounded-lg border border-slate-200 overflow-hidden">
                    <summary className="flex items-center justify-between px-4 py-3 cursor-pointer select-none bg-slate-50 hover:bg-slate-100 transition-colors list-none">
                      <div className="flex items-center gap-2 text-xs font-medium text-slate-700">
                        <FaKey className="text-slate-500 text-[10px]" />
                        ความปลอดภัย — เปลี่ยนรหัสผ่าน
                      </div>
                      <FaChevronDown className="text-slate-500 text-[10px] transition-transform group-open:rotate-180" />
                    </summary>
                    <div className="px-4 py-3 border-t border-slate-100">
                      <Form method="post" className="flex flex-col sm:flex-row sm:items-end gap-3">
                        <input type="hidden" name="intent" value="reset_password" />
                        <input type="hidden" name="co_admin_id" value={coAdmin.id} />
                        <div className="flex-1 space-y-1">
                          <Label htmlFor={`pw-${coAdmin.id}`} className="text-xs">รหัสผ่านใหม่</Label>
                          <Input
                            id={`pw-${coAdmin.id}`}
                            name="new_password"
                            type="password"
                            minLength={6}
                            required
                            placeholder="อย่างน้อย 6 ตัวอักษร"
                            className="h-9 text-sm"
                          />
                          {errors?.new_password && <p className="text-xs text-red-500">{errors.new_password[0]}</p>}
                        </div>
                        <button
                          type="submit"
                          onClick={(e) => { if (!confirm(`เปลี่ยนรหัสผ่านของ "${coAdmin.name}"?`)) e.preventDefault(); }}
                          className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap"
                        >
                          <FaKey className="text-[10px]" />
                          บันทึกรหัสผ่าน
                        </button>
                      </Form>
                    </div>
                  </details>

                  {/* Assigned clients */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-slate-700">
                        ลูกค้าที่ดูแล
                        <span className="ml-1.5 text-slate-500 font-normal">({coAdmin.assigned_clients.length})</span>
                      </p>
                    </div>

                    {/* Add client row */}
                    <Form method="post" className="flex flex-col sm:flex-row gap-2">
                      <input type="hidden" name="intent" value="assign" />
                      <input type="hidden" name="co_admin_id" value={coAdmin.id} />
                      <select
                        name="client_id"
                        required
                        className="h-9 text-xs border border-slate-200 rounded-lg px-3 bg-white focus:outline-none focus:ring-2 focus:ring-slate-900 transition flex-1 min-w-0"
                      >
                        <option value="">เลือกลูกค้าที่จะเพิ่ม...</option>
                        {unassignedClients.map((c) => (
                          <option key={c.id} value={c.id}>{c.company_name}</option>
                        ))}
                      </select>
                      <Input
                        type="text"
                        name="telegram_group_id"
                        placeholder="Telegram Group ID (optional)"
                        className="h-9 text-xs flex-1 min-w-0"
                      />
                      <button
                        type="submit"
                        className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-medium text-white bg-slate-900 hover:bg-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
                      >
                        <FaPlus className="text-[10px]" />
                        เพิ่ม
                      </button>
                    </Form>

                    {/* Client list */}
                    {coAdmin.assigned_clients.length === 0 ? (
                      <p className="text-xs text-slate-500 py-3 text-center border border-dashed border-slate-200 rounded-lg">
                        ยังไม่ได้รับมอบหมายลูกค้า
                      </p>
                    ) : (
                      <div className="rounded-lg border border-slate-200 divide-y divide-slate-100 overflow-hidden">
                        {coAdmin.assigned_clients.map((client) => (
                          <div key={client.id} className="p-3 bg-white hover:bg-slate-50/60 transition-colors">
                            <div className="flex items-start justify-between gap-3 mb-2">
                              <div>
                                <p className="text-sm font-medium text-slate-800">{client.company_name}</p>
                                {client.telegram_group_id && (
                                  <div className="flex items-center gap-1 mt-0.5 text-[11px] text-blue-600">
                                    <FaTelegram className="shrink-0" />
                                    <span className="truncate max-w-[220px]" title={client.telegram_group_id}>
                                      {client.telegram_group_id}
                                    </span>
                                  </div>
                                )}
                              </div>
                              {/* Unassign */}
                              <Form method="post">
                                <input type="hidden" name="intent" value="unassign" />
                                <input type="hidden" name="co_admin_id" value={coAdmin.id} />
                                <input type="hidden" name="client_id" value={client.id} />
                                <button
                                  type="submit"
                                  onClick={(e) => { if (!confirm(`ลบการมอบหมาย ${client.company_name}?`)) e.preventDefault(); }}
                                  className="p-1.5 rounded-lg text-slate-300 hover:text-rose-500 hover:bg-rose-50 transition-colors"
                                  title="ยกเลิกการมอบหมาย"
                                >
                                  <FaTrash className="text-[10px]" />
                                </button>
                              </Form>
                            </div>

                            {/* Telegram update + test row */}
                            <div className="flex items-center gap-2">
                              <Form method="post" className="flex items-center gap-2 flex-1 min-w-0">
                                <input type="hidden" name="intent" value="update_telegram" />
                                <input type="hidden" name="co_admin_id" value={coAdmin.id} />
                                <input type="hidden" name="client_id" value={client.id} />
                                <div className="relative flex-1 min-w-0">
                                  <FaTelegram className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] text-slate-500" />
                                  <Input
                                    type="text"
                                    name="telegram_group_id"
                                    placeholder="Telegram Group ID"
                                    defaultValue={client.telegram_group_id ?? ""}
                                    className="h-8 text-xs pl-7"
                                  />
                                </div>
                                <button
                                  type="submit"
                                  className="inline-flex items-center h-8 px-3 text-xs font-medium text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap"
                                >
                                  บันทึก
                                </button>
                              </Form>

                              {/* Test fire */}
                              <Form method="post">
                                <input type="hidden" name="intent" value="test_fire" />
                                <input type="hidden" name="co_admin_id" value={coAdmin.id} />
                                <input type="hidden" name="client_id" value={client.id} />
                                <button
                                  type="submit"
                                  onClick={(e) => {
                                    const msg = client.telegram_group_id
                                      ? `ทดสอบส่งการแจ้งเตือนไปยัง Telegram Group สำหรับ ${client.company_name}?`
                                      : `ทดสอบส่งการแจ้งเตือน (ไม่ได้ระบุ Group ID) สำหรับ ${client.company_name}?`;
                                    if (!confirm(msg)) e.preventDefault();
                                  }}
                                  className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors whitespace-nowrap"
                                >
                                  <FaPaperPlane className="text-[10px]" />
                                  ทดสอบ
                                </button>
                              </Form>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Info box ── */}
      <div className="bg-violet-50 border border-violet-100 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-100 text-violet-600 shrink-0">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </span>
          <h3 className="text-sm font-semibold text-violet-900">ข้อมูลเพิ่มเติม</h3>
        </div>
        <ul className="text-xs text-violet-800 space-y-1.5 list-disc list-inside leading-relaxed">
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
