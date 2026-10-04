import { Form, Link, redirect, useSearchParams } from "react-router";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "~/components/ui/dialog";
import { useEffect, useState } from "react";
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
  // One team: co-admin and freelance had identical permissions, so the
  // split was dropped. The team_type column stays but is no longer used.
  const listUrl = "/admin/co-admins";

  if (intent === "create") {
    const parsed = CreateSchema.safeParse(raw);
    if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };
    const { name, email, password } = parsed.data;
    const existing = await db.getUserByEmail(email);
    if (existing) return { errors: { email: ["อีเมลนี้ถูกใช้งานแล้ว"] } };
    const passwordHash = await hashPassword(password);
    await db.createUser({
      id: generateId(),
      email,
      name,
      role: "co-admin",
      team_type: "co-admin",
      password_hash: passwordHash,
      avatar_url: null,
    });
    return redirect(listUrl);
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
  const members = coAdmins;
  const errors = actionData?.errors as Record<string, string[]> | undefined;
  const success = actionData?.success as Record<string, boolean> | undefined;
  // Re-open the add dialog when the server rejected what was typed in it.
  const createFailed = Boolean(errors?.name || errors?.email || errors?.password);
  const [addOpen, setAddOpen] = useState(createFailed);
  useEffect(() => {
    if (createFailed) setAddOpen(true);
  }, [createFailed]);

  const coveredClients = new Set(members.flatMap((m) => m.assigned_client_ids)).size;

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted-ink">ทีมงาน</p>
          <h1 className="mt-1.5 text-[28px] md:text-[32px] font-bold tracking-[-0.02em] text-ink">
            {members.length > 0
              ? `ทีม ${members.length} คน ดูแลลูกค้า ${coveredClients} ราย`
              : "ยังไม่มีทีมงาน"}
          </h1>
          <p className="mt-1 text-sm text-muted-ink">
            ทีมงานเห็นเฉพาะลูกค้าที่มอบหมายให้ ตอบ Ticket ได้ และเข้าระบบด้วยรหัสผ่าน
          </p>
        </div>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button>
              <FaPlus aria-hidden="true" />
              เพิ่มทีมงาน
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>เพิ่มทีมงาน</DialogTitle>
              <DialogDescription>สร้างบัญชีแล้วค่อยมอบหมายลูกค้าทีหลัง</DialogDescription>
            </DialogHeader>
            <Form method="post" className="space-y-4" onSubmit={() => setAddOpen(false)}>
              <input type="hidden" name="intent" value="create" />
              <div className="space-y-1.5">
                <Label htmlFor="create-name">ชื่อ</Label>
                <Input id="create-name" name="name" type="text" required placeholder="ชื่อผู้ใช้" />
                {errors?.name && <p className="text-xs text-rose-600">{errors.name[0]}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="create-email">อีเมล</Label>
                <Input id="create-email" name="email" type="email" required placeholder="email@example.com" />
                {errors?.email && <p className="text-xs text-rose-600">{errors.email[0]}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="create-password">รหัสผ่าน</Label>
                <Input id="create-password" name="password" type="password" required minLength={6} placeholder="อย่างน้อย 6 ตัวอักษร" />
                {errors?.password && <p className="text-xs text-rose-600">{errors.password[0]}</p>}
              </div>
              <DialogFooter>
                <Button type="submit" className="w-full sm:w-auto">เพิ่มทีมงาน</Button>
              </DialogFooter>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      {/* ── Results of the last action ── */}
      {errors?.general && (
        <p className="rounded-[14px] bg-[#FDE7DA] px-4 py-2.5 text-sm text-[#B4541A]">{errors.general[0]}</p>
      )}
      {success?.password_reset && (
        <p className="flex items-center gap-2 rounded-[14px] bg-emerald-50 px-4 py-2.5 text-sm text-emerald-700">
          <FaCircleCheck /> เปลี่ยนรหัสผ่านเรียบร้อยแล้ว
        </p>
      )}
      {success?.test_fire && (
        <p className="flex items-center gap-2 rounded-[14px] bg-emerald-50 px-4 py-2.5 text-sm text-emerald-700">
          <FaCircleCheck /> ส่งการแจ้งเตือนทดสอบเรียบร้อยแล้ว
        </p>
      )}

      {/* ── Members ── */}
      {members.length === 0 ? (
        <div className="rounded-[20px] border border-line bg-white p-12 text-center">
          <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-paper text-ink-soft">
            <FaUsers />
          </span>
          <p className="font-semibold text-ink">ยังไม่มีทีมงาน</p>
          <p className="mt-1 text-sm text-muted-ink">กด "เพิ่มทีมงาน" เพื่อสร้างบัญชีแรก</p>
        </div>
      ) : (
        <div className="space-y-3">
          {members.map((coAdmin) => {
            const unassignedClients = clients.filter((c) => !coAdmin.assigned_client_ids.includes(c.id));
            const assigned = coAdmin.assigned_clients;
            return (
              <details key={coAdmin.id} className="group rounded-[20px] border border-line bg-white open:shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
                {/* Summary row: who, which clients, one button to manage */}
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-4 px-5 py-4 [&::-webkit-details-marker]:hidden">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] bg-ink text-sm font-bold text-brand-yellow">
                    {getInitials(coAdmin.name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-ink">{coAdmin.name}</p>
                    <p className="truncate text-sm text-muted-ink">{coAdmin.email}</p>
                  </div>
                  <div className="flex min-w-0 basis-full flex-wrap gap-1.5 sm:basis-auto sm:max-w-[45%] sm:justify-end">
                    {assigned.length === 0 ? (
                      <span className="rounded-full bg-[#FFF6C2] px-2.5 py-0.5 text-xs font-semibold text-[#6B5B00]">
                        ยังไม่ได้มอบหมายลูกค้า
                      </span>
                    ) : (
                      assigned.slice(0, 3).map((c) => (
                        <span key={c.id} className="max-w-[180px] truncate rounded-full bg-paper px-2.5 py-0.5 text-xs font-medium text-ink-soft">
                          {c.company_name.replace(/^บริษัท\s*/, "").replace(/\s*จำกัด.*$/, "")}
                        </span>
                      ))
                    )}
                    {assigned.length > 3 && (
                      <span className="rounded-full bg-paper px-2.5 py-0.5 text-xs font-medium text-muted-ink">+{assigned.length - 3}</span>
                    )}
                  </div>
                  <span className="inline-flex h-9 items-center gap-1.5 rounded-full border border-line px-3.5 text-[13px] font-semibold text-ink-soft group-open:bg-paper">
                    จัดการ
                    <FaChevronDown className="text-[10px] transition-transform group-open:rotate-180" />
                  </span>
                </summary>

                <div className="space-y-6 border-t border-line-soft px-5 py-5">
                  {/* Clients */}
                  <section className="space-y-3">
                    <h3 className="text-sm font-semibold text-ink">
                      ลูกค้าที่ดูแล <span className="font-normal text-muted-ink">({assigned.length})</span>
                    </h3>

                    {assigned.length > 0 && (
                      <ul className="divide-y divide-line-soft rounded-[14px] border border-line">
                        {assigned.map((client) => (
                          <li key={client.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-ink">{client.company_name}</p>
                              <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-ink">
                                <FaTelegram aria-hidden="true" />
                                {client.telegram_group_id ? "แจ้งเตือนเข้ากลุ่ม Telegram แล้ว" : "ใช้กลุ่ม Telegram หลัก"}
                              </p>
                            </div>
                            <Form method="post">
                              <input type="hidden" name="intent" value="test_fire" />
                              <input type="hidden" name="co_admin_id" value={coAdmin.id} />
                              <input type="hidden" name="client_id" value={client.id} />
                              <ConfirmButton
                                message={`ส่งข้อความทดสอบเข้า Telegram ของ ${client.company_name}?`}
                                confirmLabel="ส่งทดสอบ"
                                className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line bg-white px-3 text-xs font-medium text-ink-soft hover:bg-paper"
                              >
                                <FaPaperPlane className="text-[10px]" aria-hidden="true" />
                                ทดสอบ
                              </ConfirmButton>
                            </Form>
                            <Form method="post">
                              <input type="hidden" name="intent" value="unassign" />
                              <input type="hidden" name="co_admin_id" value={coAdmin.id} />
                              <input type="hidden" name="client_id" value={client.id} />
                              <ConfirmButton
                                message={`เลิกให้ ${coAdmin.name} ดูแล ${client.company_name}?`}
                                confirmLabel="เอาออก"
                                destructive
                                className="inline-flex h-8 items-center rounded-full px-3 text-xs font-medium text-muted-ink hover:bg-[#FDE7DA] hover:text-[#B4541A]"
                              >
                                เอาออก
                              </ConfirmButton>
                            </Form>
                            {/* Telegram group per client, tucked away: most use the default group */}
                            <details className="basis-full">
                              <summary className="cursor-pointer list-none text-xs font-medium text-muted-ink hover:text-ink [&::-webkit-details-marker]:hidden">
                                ตั้งกลุ่ม Telegram เฉพาะลูกค้านี้ ›
                              </summary>
                              <Form method="post" className="mt-2 flex flex-col gap-2 sm:flex-row">
                                <input type="hidden" name="intent" value="update_telegram" />
                                <input type="hidden" name="co_admin_id" value={coAdmin.id} />
                                <input type="hidden" name="client_id" value={client.id} />
                                <Input
                                  type="text"
                                  name="telegram_group_id"
                                  aria-label={`Telegram group ของ ${client.company_name}`}
                                  placeholder="-100…:topic หรือวางลิงก์ t.me/c/…"
                                  defaultValue={client.telegram_group_id ?? ""}
                                  className="flex-1 text-sm"
                                />
                                <Button type="submit" variant="outline">บันทึก</Button>
                              </Form>
                            </details>
                          </li>
                        ))}
                      </ul>
                    )}

                    {unassignedClients.length > 0 && (
                      <Form method="post" className="flex flex-col gap-2 sm:flex-row">
                        <input type="hidden" name="intent" value="assign" />
                        <input type="hidden" name="co_admin_id" value={coAdmin.id} />
                        <NativeSelect name="client_id" required wrapperClassName="flex-1 min-w-0" aria-label="เลือกลูกค้า">
                          <option value="">+ มอบหมายลูกค้าเพิ่ม…</option>
                          {unassignedClients.map((c) => (
                            <option key={c.id} value={c.id}>{c.company_name}</option>
                          ))}
                        </NativeSelect>
                        <Button type="submit">มอบหมาย</Button>
                      </Form>
                    )}
                  </section>

                  {/* Account actions */}
                  <section className="space-y-3 border-t border-line-soft pt-5">
                    <h3 className="text-sm font-semibold text-ink">บัญชี</h3>
                    <Form method="post" className="flex flex-col gap-2 sm:flex-row">
                      <input type="hidden" name="intent" value="reset_password" />
                      <input type="hidden" name="co_admin_id" value={coAdmin.id} />
                      <Input
                        name="new_password"
                        type="password"
                        minLength={6}
                        required
                        aria-label="รหัสผ่านใหม่"
                        placeholder="รหัสผ่านใหม่ (อย่างน้อย 6 ตัวอักษร)"
                        className="flex-1"
                      />
                      <ConfirmButton
                        message={`เปลี่ยนรหัสผ่านของ "${coAdmin.name}"?`}
                        confirmLabel="เปลี่ยนรหัสผ่าน"
                        className="inline-flex h-10 items-center gap-1.5 rounded-full border border-line bg-white px-4 text-[13px] font-semibold text-ink-soft hover:bg-paper"
                      >
                        <FaKey className="text-[11px]" aria-hidden="true" />
                        เปลี่ยนรหัสผ่าน
                      </ConfirmButton>
                    </Form>
                    {errors?.new_password && <p className="text-xs text-rose-600">{errors.new_password[0]}</p>}
                    <div className="flex flex-wrap gap-2">
                      <Form method="post">
                        <input type="hidden" name="intent" value="impersonate" />
                        <input type="hidden" name="co_admin_id" value={coAdmin.id} />
                        <ConfirmButton
                          message={`ดูระบบในมุมมองของ "${coAdmin.name}"?`}
                          confirmLabel="ดูในมุมมองนี้"
                          className="inline-flex h-10 items-center gap-1.5 rounded-full border border-line bg-white px-4 text-[13px] font-semibold text-ink-soft hover:bg-paper"
                        >
                          <FaUserCheck className="text-[11px]" aria-hidden="true" />
                          ดูในมุมมองนี้
                        </ConfirmButton>
                      </Form>
                      <Form method="post">
                        <input type="hidden" name="intent" value="delete" />
                        <input type="hidden" name="co_admin_id" value={coAdmin.id} />
                        <ConfirmButton
                          message={`เอา "${coAdmin.name}" ออกจากลูกค้าทุกรายที่ดูแลอยู่?`}
                          confirmLabel="เอาออกจากลูกค้าทั้งหมด"
                          destructive
                          className="inline-flex h-10 items-center gap-1.5 rounded-full px-4 text-[13px] font-semibold text-[#B4541A] hover:bg-[#FDE7DA]"
                        >
                          <FaTrash className="text-[11px]" aria-hidden="true" />
                          เอาออกจากลูกค้าทั้งหมด
                        </ConfirmButton>
                      </Form>
                    </div>
                  </section>
                </div>
              </details>
            );
          })}
        </div>
      )}
    </div>
  );
}
