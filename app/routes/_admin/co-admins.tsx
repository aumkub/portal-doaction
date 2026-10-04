import { Form, Link, redirect, useSearchParams } from "react-router";
import { ConfirmButton } from "~/components/ui/confirm-button";
import { z } from "zod";
import type { Route } from "./+types/co-admins";
import { requireAdmin, hashPassword, startImpersonation, evictUserCache } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";
import { generateId } from "~/lib/utils";
import { useT } from "~/lib/i18n";
import {
  formatTelegramTarget,
  sendTelegramNotification,
  sendTelegramNotificationToGroup,
} from "~/lib/telegram.server";
import { NativeSelect } from "~/components/ui/native-select";
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
  FaLaptopCode,
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
  team_type: z.enum(["co-admin", "freelance"]).default("co-admin"),
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
  const tab = formData.get("tab") === "freelance" || formData.get("team_type") === "freelance"
    ? "freelance"
    : "co-admin";
  const listUrl = tab === "freelance" ? "/admin/co-admins?tab=freelance" : "/admin/co-admins";

  if (intent === "create") {
    const parsed = CreateSchema.safeParse(raw);
    if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };
    const { name, email, password, team_type } = parsed.data;
    const existing = await db.getUserByEmail(email);
    if (existing) return { errors: { email: ["อีเมลนี้ถูกใช้งานแล้ว"] } };
    const passwordHash = await hashPassword(password);
    await db.createUser({
      id: generateId(),
      email,
      name,
      role: "co-admin",
      team_type,
      password_hash: passwordHash,
      avatar_url: null,
    });
    return redirect(team_type === "freelance" ? "/admin/co-admins?tab=freelance" : "/admin/co-admins");
  }

  if (intent === "assign") {
    const parsed = AssignSchema.safeParse(raw);
    if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };
    const { co_admin_id, client_id, telegram_group_id } = parsed.data;
    await db.addCoAdminClient(co_admin_id, client_id, formatTelegramTarget(telegram_group_id));
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
    await db.updateCoAdminClientTelegramGroup(co_admin_id, client_id, formatTelegramTarget(telegram_group_id));
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
    } catch (err) {
      return {
        errors: {
          general: [err instanceof Error ? err.message : "ส่งการแจ้งเตือนไม่สำเร็จ"],
        },
      };
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
    await evictUserCache(context.cloudflare.env.SESSIONPORTAL, co_admin_id);
    return { success: { password_reset: true } };
  }

  if (intent === "delete") {
    const parsed = DeleteSchema.safeParse(raw);
    if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };
    await db.removeAllCoAdminAssignments(parsed.data.co_admin_id);
    return redirect(listUrl);
  }

  return { errors: { general: ["Invalid intent"] } };
}

function getInitials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

function avatarColor(name: string) {
  const colors = [
    "bg-paper text-ink-soft", "bg-paper text-ink-soft",
    "bg-paper text-ink", "bg-paper text-ink",
    "bg-paper text-ink-soft", "bg-paper text-ink-soft",
    "bg-paper text-ink", "bg-paper text-ink",
  ];
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) & 0xffff;
  return colors[hash % colors.length];
}

export default function CoAdminsPage({ loaderData, actionData }: Route.ComponentProps) {
  const { coAdmins, clients } = loaderData;
  const { t } = useT();
  const [searchParams] = useSearchParams();
  const tab = searchParams.get("tab") === "freelance" ? "freelance" : "co-admin";
  const isFreelance = tab === "freelance";
  const members = coAdmins.filter((person) =>
    isFreelance ? person.team_type === "freelance" : person.team_type !== "freelance"
  );
  const errors = actionData?.errors as Record<string, string[]> | undefined;
  const success = actionData?.success as Record<string, boolean> | undefined;

  const totalAssignments = members.reduce((sum, ca) => sum + ca.assigned_clients.length, 0);
  const label = isFreelance ? "Freelance" : "Co-Admin";
  const badgeCls = isFreelance
    ? "text-sky-700 bg-sky-50 ring-sky-200"
    : "text-emerald-700 bg-emerald-50 ring-emerald-200";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[28px] md:text-[32px] font-bold tracking-[-0.02em] text-ink">จัดการทีมงาน</h1>
        <p className="text-muted-ink text-sm mt-1">สลับแท็บเพื่อจัดการ Co-Admin หรือ Freelance แล้วมอบหมายลูกค้า</p>
      </div>

      <div className="inline-flex rounded-full bg-[#ECEAE3] p-[3px] gap-0.5 w-full sm:w-fit">
        <Link
          to="/admin/co-admins"
          className={`inline-flex flex-1 sm:flex-none justify-center items-center gap-2 h-9 px-4 rounded-full text-[13px] font-medium transition-all ${
            !isFreelance ? "bg-white text-ink shadow-[0_1px_2px_rgba(0,0,0,0.08)]" : "text-muted-ink hover:text-ink"
          }`}
        >
          <FaUserSecret className="text-[11px]" />
          {t("team_tab_co_admin")}
        </Link>
        <Link
          to="/admin/co-admins?tab=freelance"
          className={`inline-flex flex-1 sm:flex-none justify-center items-center gap-2 h-9 px-4 rounded-full text-[13px] font-medium transition-all ${
            isFreelance ? "bg-white text-ink shadow-[0_1px_2px_rgba(0,0,0,0.08)]" : "text-muted-ink hover:text-ink"
          }`}
        >
          <FaLaptopCode className="text-[11px]" />
          {t("team_tab_freelance")}
        </Link>
      </div>

      {/* ── Stats strip ── */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-[20px] border border-line bg-white px-5 py-4 flex items-center gap-3">
          <span className={`flex h-9 w-9 items-center justify-center rounded-[10px] shrink-0 ${
            "bg-paper text-ink"
          }`}>
            {isFreelance ? <FaLaptopCode className="text-sm" /> : <FaUserSecret className="text-sm" />}
          </span>
          <div>
            <p className="text-xs text-muted-ink">{label} ทั้งหมด</p>
            <p className="text-2xl font-semibold tracking-tight tabular-nums text-ink">{members.length}</p>
          </div>
        </div>
        <div className="rounded-[20px] border border-line bg-white px-5 py-4 flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-paper text-ink-soft shrink-0">
            <FaUsers className="text-sm" />
          </span>
          <div>
            <p className="text-xs text-muted-ink">การมอบหมายทั้งหมด</p>
            <p className="text-2xl font-semibold tracking-tight tabular-nums text-ink">{totalAssignments}</p>
          </div>
        </div>
      </div>

      {/* ── Create form ── */}
      <div className="bg-white rounded-[20px] border border-line overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-line-soft">
          <FaCirclePlus className="text-faint-ink text-sm" />
          <p className="text-sm font-semibold text-ink">เพิ่ม {label} ใหม่</p>
        </div>
        <div className="p-5">
          <Form method="post" className="grid sm:grid-cols-4 gap-4 items-end">
            <input type="hidden" name="intent" value="create" />
            <input type="hidden" name="team_type" value={tab} />
            <input type="hidden" name="tab" value={tab} />
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
            <Button type="submit" className="bg-ink hover:bg-black text-white">
              <FaCirclePlus aria-hidden="true" />
              เพิ่ม {label}
            </Button>
          </Form>

          {errors?.general && (
            <p className="mt-3 flex items-center gap-2 text-xs font-medium text-rose-700 bg-rose-50 border border-rose-200 rounded-[14px] px-3 py-2">
              {errors.general[0]}
            </p>
          )}
          {/* Success toasts */}
          {success?.password_reset && (
            <p className="mt-3 flex items-center gap-2 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-[14px] px-3 py-2">
              <FaCircleCheck /> เปลี่ยนรหัสผ่านเรียบร้อยแล้ว
            </p>
          )}
          {success?.test_fire && (
            <p className="mt-3 flex items-center gap-2 text-xs font-medium text-sky-700 bg-sky-50 ring-1 ring-inset ring-sky-600/20 rounded-md px-3 py-2">
              <FaCircleCheck /> ส่งการแจ้งเตือนทดสอบเรียบร้อยแล้ว
            </p>
          )}
        </div>
      </div>

      {/* ── Co-admin cards ── */}
      {members.length === 0 ? (
        <div className="bg-white rounded-[20px] border border-line p-16 text-center">
          {isFreelance ? (
            <FaLaptopCode className="mx-auto text-3xl text-line mb-3" />
          ) : (
            <FaUserSecret className="mx-auto text-3xl text-line mb-3" />
          )}
          <p className="text-sm text-muted-ink">ยังไม่มี {label}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {members.map((coAdmin) => {
            const initials = getInitials(coAdmin.name);
            const avatarCls = avatarColor(coAdmin.name);
            const unassignedClients = clients.filter((c) => !coAdmin.assigned_client_ids.includes(c.id));
            return (
              <div key={coAdmin.id} className="bg-white rounded-[20px] border border-line overflow-hidden">
                {/* Card header */}
                <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between px-5 py-4 border-b border-line-soft">
                  <div className="flex items-center gap-3">
                    <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] text-xs font-semibold ${avatarCls}`}>
                      {initials}
                    </span>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-ink">{coAdmin.name}</p>
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-md ring-1 ring-inset ${badgeCls}`}>
                          {isFreelance ? "FREELANCE" : "CO-ADMIN"}
                        </span>
                      </div>
                      <p className="text-xs text-muted-ink mt-0.5">{coAdmin.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {/* Impersonate */}
                    <Form method="post">
                      <input type="hidden" name="intent" value="impersonate" />
                      <input type="hidden" name="co_admin_id" value={coAdmin.id} />
                      <input type="hidden" name="tab" value={tab} />
                      <ConfirmButton
                        message={`จำลองบทบาทเป็น "${coAdmin.name}"?`}
                        confirmLabel="จำลองบทบาท"
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 px-3 py-1.5 rounded-full transition-colors"
                      >
                        <FaUserCheck className="text-[10px]" />
                        จำลองบทบาท
                      </ConfirmButton>
                    </Form>
                    {/* Delete */}
                    <Form method="post">
                      <input type="hidden" name="intent" value="delete" />
                      <input type="hidden" name="co_admin_id" value={coAdmin.id} />
                      <input type="hidden" name="tab" value={tab} />
                      <ConfirmButton
                        message={`ลบ ${label} นี้?`}
                        confirmLabel="ลบ"
                        destructive
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-200 px-3 py-1.5 rounded-full transition-colors"
                      >
                        <FaTrash className="text-[10px]" />
                        ลบ
                      </ConfirmButton>
                    </Form>
                  </div>
                </div>

                <div className="p-5 space-y-5">
                  {/* Reset password (collapsible) */}
                  <details className="group rounded-[14px] border border-line overflow-hidden">
                    <summary className="flex items-center justify-between px-4 py-3 cursor-pointer select-none bg-paper hover:bg-paper transition-colors list-none">
                      <div className="flex items-center gap-2 text-xs font-medium text-ink-soft">
                        <FaKey className="text-muted-ink text-[10px]" />
                        ความปลอดภัย — เปลี่ยนรหัสผ่าน
                      </div>
                      <FaChevronDown className="text-muted-ink text-[10px] transition-transform group-open:rotate-180" />
                    </summary>
                    <div className="px-4 py-3 border-t border-line-soft">
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
                        <ConfirmButton
                          message={`เปลี่ยนรหัสผ่านของ "${coAdmin.name}"?`}
                          confirmLabel="บันทึกรหัสผ่าน"
                          className="inline-flex items-center gap-1.5 h-10 px-4 text-[13px] font-semibold text-ink-soft bg-white border border-line hover:bg-paper rounded-full transition-colors whitespace-nowrap"
                        >
                          <FaKey className="text-[10px]" />
                          บันทึกรหัสผ่าน
                        </ConfirmButton>
                      </Form>
                    </div>
                  </details>

                  {/* Assigned clients */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-ink-soft">
                        ลูกค้าที่ดูแล
                        <span className="ml-1.5 text-muted-ink font-normal">({coAdmin.assigned_clients.length})</span>
                      </p>
                    </div>

                    {/* Add client row */}
                    <Form method="post" className="flex flex-col sm:flex-row gap-2">
                      <input type="hidden" name="intent" value="assign" />
                      <input type="hidden" name="co_admin_id" value={coAdmin.id} />
                      <NativeSelect
                        name="client_id"
                        required
                        size="sm"
                        wrapperClassName="flex-1 min-w-0"
                      >
                        <option value="">เลือกลูกค้าที่จะเพิ่ม...</option>
                        {unassignedClients.map((c) => (
                          <option key={c.id} value={c.id}>{c.company_name}</option>
                        ))}
                      </NativeSelect>
                      <Input
                        type="text"
                        name="telegram_group_id"
                        placeholder="-1004487258170:5 หรือวางลิงก์ t.me/c/…"
                        className="h-9 text-xs flex-1 min-w-0"
                      />
                      <p className="text-[11px] text-muted-ink sm:col-span-full">
                        กลุ่มแบบ Topics ต้องมี <span className="font-mono">{":เลข topic"}</span> ไม่เช่นนั้นจะเข้า General
                      </p>
                      <button
                        type="submit"
                        className="inline-flex items-center gap-1.5 h-10 px-4 text-[13px] font-semibold text-white bg-ink hover:bg-black rounded-full transition-colors whitespace-nowrap shrink-0"
                      >
                        <FaPlus className="text-[10px]" />
                        เพิ่ม
                      </button>
                    </Form>

                    {/* Client list */}
                    {coAdmin.assigned_clients.length === 0 ? (
                      <p className="text-xs text-muted-ink py-3 text-center border border-dashed border-line rounded-[14px]">
                        ยังไม่ได้รับมอบหมายลูกค้า
                      </p>
                    ) : (
                      <div className="rounded-[14px] border border-line divide-y divide-line-soft overflow-hidden">
                        {coAdmin.assigned_clients.map((client) => (
                          <div key={client.id} className="p-3 bg-white hover:bg-paper/60 transition-colors">
                            <div className="flex items-start justify-between gap-3 mb-2">
                              <div>
                                <p className="text-sm font-medium text-ink">{client.company_name}</p>
                                {client.telegram_group_id && (
                                  <div className="flex items-center gap-1 mt-0.5 text-[11px] text-muted-ink">
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
                                <ConfirmButton
                                  message={`ลบการมอบหมาย ${client.company_name}?`}
                                  confirmLabel="ยกเลิกการมอบหมาย"
                                  destructive
                                  className="p-1.5 rounded-[14px] text-faint-ink hover:text-rose-500 hover:bg-rose-50 transition-colors"
                                  title="ยกเลิกการมอบหมาย"
                                >
                                  <FaTrash className="text-[10px]" />
                                </ConfirmButton>
                              </Form>
                            </div>

                            {/* Telegram update + test row */}
                            <div className="flex items-center gap-2">
                              <Form method="post" className="flex items-center gap-2 flex-1 min-w-0">
                                <input type="hidden" name="intent" value="update_telegram" />
                                <input type="hidden" name="co_admin_id" value={coAdmin.id} />
                                <input type="hidden" name="client_id" value={client.id} />
                                <div className="relative flex-1 min-w-0">
                                  <FaTelegram className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] text-muted-ink" />
                                  <Input
                                    type="text"
                                    name="telegram_group_id"
                                    placeholder="-100…:topic หรือลิงก์ t.me/c/…"
                                    defaultValue={client.telegram_group_id ?? ""}
                                    className="h-8 text-xs pl-7"
                                  />
                                </div>
                                <button
                                  type="submit"
                                  className="inline-flex items-center h-8 px-3 text-xs font-medium text-ink-soft bg-white border border-line hover:bg-paper rounded-full transition-colors whitespace-nowrap"
                                >
                                  บันทึก
                                </button>
                              </Form>

                              {/* Test fire */}
                              <Form method="post">
                                <input type="hidden" name="intent" value="test_fire" />
                                <input type="hidden" name="co_admin_id" value={coAdmin.id} />
                                <input type="hidden" name="client_id" value={client.id} />
                                <ConfirmButton
                                  message={client.telegram_group_id
                                    ? `ทดสอบส่งการแจ้งเตือนไปยัง Telegram Group สำหรับ ${client.company_name}?`
                                    : `ทดสอบส่งการแจ้งเตือน (ไม่ได้ระบุ Group ID) สำหรับ ${client.company_name}?`}
                                  confirmLabel="ส่งทดสอบ"
                                  className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium text-ink-soft bg-white hover:bg-paper border border-line rounded-md  transition-colors whitespace-nowrap"
                                >
                                  <FaPaperPlane className="text-[10px]" />
                                  ทดสอบ
                                </ConfirmButton>
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
      <div className="bg-white border border-line rounded-[20px] p-6 ">
        <div className="flex items-center gap-2 mb-3">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-paper text-ink-soft shrink-0">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </span>
          <h3 className="text-sm font-semibold text-ink">ข้อมูลเพิ่มเติม</h3>
        </div>
        <ul className="text-xs text-ink-soft space-y-1.5 list-disc list-inside leading-relaxed">
          <li>{label} สามารถดูข้อมูลเฉพาะลูกค้าที่ได้รับมอบหมายเท่านั้น</li>
          <li>{label} สามารถตอบทิกเก็ตได้ แต่อ่านรายงานแบบ Read-Only</li>
          <li>{label} ไม่สามารถเข้าถึง Settings, Email Logs, และ Attachments</li>
          <li>{label} ต้องใช้รหัสผ่านในการเข้าสู่ระบบ (ไม่รองรับ Magic Link)</li>
          <li>สามารถตั้งค่า Telegram Group ID สำหรับแต่ละลูกค้าเพื่อรับการแจ้งเตือนเฉพาะกลุ่ม</li>
        </ul>
      </div>
    </div>
  );
}
