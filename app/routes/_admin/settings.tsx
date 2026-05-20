import { Form, redirect } from "react-router";
import { z } from "zod";
import { requireAdmin } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";
import { useT } from "~/lib/i18n";
import { sendTelegramNotification } from "~/lib/telegram.server";
import {
  FaCircleCheck,
  FaPaperPlane,
  FaUser,
  FaUsers,
  FaPlug,
  FaShieldHalved,
  FaBell,
  FaCircleInfo,
  FaTelegram,
} from "react-icons/fa6";

export function meta() {
  return [{ title: "Settings — Admin" }];
}

const ProfileSchema = z.object({
  name: z.string().min(1, "Name is required"),
  intent: z.literal("profile"),
});

const TelegramSchema = z.object({
  telegram_bot_token: z.string().optional().default(""),
  telegram_default_group_id: z.string().optional().default(""),
  intent: z.literal("telegram"),
});

const ContractWarningSchema = z.object({
  intent: z.literal("contract_warning"),
  first_days: z.coerce.number().int().min(0).default(14),
  second_days: z.coerce.number().int().min(0).default(7),
  third_days: z.coerce.number().int().min(0).default(1),
});

const TicketReminderSchema = z.object({
  intent: z.literal("ticket_reminder"),
  enabled: z.string().optional().default("0"),
  days: z.coerce.number().int().min(1).max(30).default(1),
  hour: z.coerce.number().int().min(0).max(23).default(9),
});

export async function loader({ request, context }: any) {
  const env = context.cloudflare.env;
  const admin = await requireAdmin(request, env.DB, env.SESSIONPORTAL);
  const db = createDB(env.DB);
  const adminUsers = await db.listAdminUsers();
  const telegramBotToken = await db.getAppSetting("telegram_bot_token");
  const telegramDefaultGroupId = await db.getAppSetting("telegram_default_group_id");
  const contractWarningFirstDays = Number((await db.getAppSetting("contract_warning_first_days")) ?? "14");
  const contractWarningSecondDays = Number((await db.getAppSetting("contract_warning_second_days")) ?? "7");
  const contractWarningThirdDays = Number((await db.getAppSetting("contract_warning_third_days")) ?? "1");
  const uptimeKey = (env as any).UPTIMEROBOT_API_KEY ?? "ur2618139-5281beb51ff9820a629669c2";
  const ticketReminderEnabled = (await db.getAppSetting("ticket_reminder_enabled")) !== "0";
  const ticketReminderDays = Number((await db.getAppSetting("ticket_reminder_days")) ?? "1");
  const ticketReminderHour = Number((await db.getAppSetting("ticket_reminder_hour")) ?? "9");
  return {
    admin, adminUsers, uptimeKey,
    telegramBotToken, telegramDefaultGroupId,
    contractWarningFirstDays, contractWarningSecondDays, contractWarningThirdDays,
    ticketReminderEnabled, ticketReminderDays, ticketReminderHour,
  };
}

export async function action({ request, context }: any) {
  const env = context.cloudflare.env;
  const admin = await requireAdmin(request, env.DB, env.SESSIONPORTAL);
  const db = createDB(env.DB);
  const formData = await request.formData();
  const raw = Object.fromEntries(formData);
  const intent = formData.get("intent");

  if (intent === "telegram") {
    const parsed = TelegramSchema.safeParse(raw);
    if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };
    const token = parsed.data.telegram_bot_token.trim();
    if (token) await db.setAppSetting("telegram_bot_token", token);
    else await db.deleteAppSetting("telegram_bot_token");
    const defaultGroupId = parsed.data.telegram_default_group_id.trim();
    if (defaultGroupId) await db.setAppSetting("telegram_default_group_id", defaultGroupId);
    else await db.deleteAppSetting("telegram_default_group_id");
    return redirect("/admin/settings");
  }

  if (intent === "contract_warning") {
    const parsed = ContractWarningSchema.safeParse(raw);
    if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };
    await db.setAppSetting("contract_warning_first_days", String(parsed.data.first_days));
    await db.setAppSetting("contract_warning_second_days", String(parsed.data.second_days));
    await db.setAppSetting("contract_warning_third_days", String(parsed.data.third_days));
    return redirect("/admin/settings");
  }

  if (intent === "ticket_reminder") {
    const parsed = TicketReminderSchema.safeParse(raw);
    if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };
    await db.setAppSetting("ticket_reminder_enabled", parsed.data.enabled === "1" ? "1" : "0");
    await db.setAppSetting("ticket_reminder_days", String(parsed.data.days));
    await db.setAppSetting("ticket_reminder_hour", String(parsed.data.hour));
    return { success: { ticket_reminder: true } };
  }

  if (intent === "telegram_test") {
    const token = await db.getAppSetting("telegram_bot_token");
    if (!token) return { errors: { telegram_bot_token: ["Please set Telegram bot token first"] } };
    await sendTelegramNotification({
      db, appUrl: env.APP_URL,
      notification: {
        title: "Test notification from do action portal",
        body: `Admin ${admin.name} sent a Telegram test message.`,
        link: "/admin/settings",
      },
    });
    return { success: { telegram: true } };
  }

  const parsed = ProfileSchema.safeParse(raw);
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };
  await db.updateUser(admin.id, { name: parsed.data.name });
  return redirect("/admin/settings");
}

function SectionCard({ icon, title, subtitle, children }: {
  icon: React.ReactNode; title: string; subtitle?: string; children: React.ReactNode;
}) {
  return (
    <section className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-100">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-600 shrink-0 text-sm">
          {icon}
        </span>
        <div>
          <p className="text-sm font-semibold text-slate-900">{title}</p>
          {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
        </div>
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function fieldCls(extra = "") {
  return `w-full h-10 rounded-lg border border-slate-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 transition ${extra}`;
}

export default function AdminSettingsPage({ loaderData, actionData }: any) {
  const {
    admin, adminUsers, uptimeKey,
    telegramBotToken, telegramDefaultGroupId,
    contractWarningFirstDays, contractWarningSecondDays, contractWarningThirdDays,
    ticketReminderEnabled, ticketReminderDays, ticketReminderHour,
  } = loaderData;
  const errors = actionData?.errors;
  const telegramTestSuccess = Boolean(actionData?.success?.telegram);
  const ticketReminderSaved = Boolean(actionData?.success?.ticket_reminder);
  const { t } = useT();

  const maskedKey =
    uptimeKey.length > 12
      ? `${uptimeKey.slice(0, 6)}${"•".repeat(uptimeKey.length - 12)}${uptimeKey.slice(-6)}`
      : "•".repeat(uptimeKey.length);
  const maskedTelegramToken = telegramBotToken
    ? telegramBotToken.length > 12
      ? `${telegramBotToken.slice(0, 6)}${"•".repeat(telegramBotToken.length - 12)}${telegramBotToken.slice(-6)}`
      : "•".repeat(telegramBotToken.length)
    : "";

  return (
    <div className="space-y-6 max-w-3xl">
      {/* ── Page header ── */}
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">{t("admin_settings_title")}</h1>
        <p className="text-slate-500 text-sm mt-0.5">{t("admin_settings_subtitle")}</p>
      </div>

      {/* ── My Account ── */}
      <SectionCard icon={<FaUser />} title={t("admin_settings_my_account")}>
        <Form method="post" className="space-y-4">
          <input type="hidden" name="intent" value="profile" />
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-600">{t("admin_settings_name")}</label>
              <input name="name" defaultValue={admin.name} required className={fieldCls()} />
              {errors?.name && <p className="text-xs text-red-500">{errors.name[0]}</p>}
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-600">{t("admin_settings_email")}</label>
              <input value={admin.email} readOnly className={fieldCls("bg-slate-50 text-slate-500 cursor-not-allowed")} />
            </div>
          </div>
          <div className="flex justify-end">
            <button type="submit" className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 transition-colors">
              {t("save")}
            </button>
          </div>
        </Form>
      </SectionCard>

      {/* ── Admin Team ── */}
      <SectionCard
        icon={<FaUsers />}
        title={t("admin_settings_team")}
        subtitle={`${adminUsers.length} คน`}
      >
        <ul className="divide-y divide-slate-100 -my-1">
          {adminUsers.map((u: any) => (
            <li key={u.id} className="flex items-center justify-between py-3">
              <div>
                <p className="text-sm font-medium text-slate-800">{u.name}</p>
                <p className="text-xs text-slate-500">{u.email}</p>
              </div>
              {u.id === admin.id && (
                <span className="text-xs text-slate-500 bg-slate-100 px-2.5 py-1 rounded-full">
                  {t("admin_settings_you")}
                </span>
              )}
            </li>
          ))}
        </ul>
      </SectionCard>

      {/* ── Integrations ── */}
      <SectionCard icon={<FaPlug />} title={t("admin_settings_integrations")} subtitle="เชื่อมต่อบริการภายนอก">
        <div className="space-y-4">
          {/* Uptime Robot */}
          <div className="rounded-lg border border-slate-100 bg-slate-50 p-4 space-y-2">
            <div className="flex items-center gap-2">
              <FaCircleCheck className="text-emerald-500 shrink-0" />
              <p className="text-sm font-medium text-slate-800">{t("admin_settings_uptime")}</p>
              <span className="ml-auto text-xs text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-full font-medium ring-1 ring-emerald-200">
                {t("admin_settings_connected")}
              </span>
            </div>
            <p className="text-xs text-slate-500">{t("admin_settings_uptime_desc")}</p>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs text-slate-500 font-mono bg-white border border-slate-200 rounded-lg px-3 py-1.5 select-all">
                {maskedKey}
              </span>
              <span className="text-xs text-slate-500">{t("admin_settings_api_key_note")}</span>
            </div>
          </div>

          {/* Telegram */}
          <Form method="post" className="rounded-lg border border-slate-100 bg-slate-50 p-4 space-y-4">
            <input type="hidden" name="intent" value="telegram" />
            <div className="flex items-center gap-2">
              <FaTelegram className="text-[#229ED9] shrink-0" />
              <p className="text-sm font-medium text-slate-800">{t("admin_settings_telegram")}</p>
              {telegramBotToken && (
                <span className="ml-auto text-xs text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-full font-medium ring-1 ring-emerald-200">
                  {t("admin_settings_connected")}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500">{t("admin_settings_telegram_desc")}</p>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-600">Bot Token</label>
              <input
                name="telegram_bot_token"
                type="text"
                defaultValue={telegramBotToken ?? ""}
                placeholder="123456789:AA..."
                className={fieldCls("font-mono")}
              />
              {maskedTelegramToken && (
                <p className="text-xs text-slate-500">
                  {t("admin_settings_saved_token")}: <span className="font-mono">{maskedTelegramToken}</span>
                </p>
              )}
              {errors?.telegram_bot_token && (
                <p className="text-xs text-rose-600">{errors.telegram_bot_token[0]}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-600">
                Default Group ID <span className="text-slate-500 font-normal">(optional)</span>
              </label>
              <p className="text-xs text-slate-500">
                กลุ่มเริ่มต้นที่จะใช้ส่งการแจ้งเตือนเมื่อ Co-Admin ไม่ได้ระบุ Group ID เฉพาะ
              </p>
              <input
                name="telegram_default_group_id"
                type="text"
                defaultValue={telegramDefaultGroupId ?? ""}
                placeholder="-1001234567890"
                className={fieldCls("font-mono")}
              />
              {errors?.telegram_default_group_id && (
                <p className="text-xs text-rose-600 mt-1">{errors.telegram_default_group_id[0]}</p>
              )}
            </div>

            {telegramTestSuccess && (
              <p className="flex items-center gap-2 text-xs text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                <FaCircleCheck /> {t("admin_settings_telegram_test_sent")}
              </p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Form method="post">
                <input type="hidden" name="intent" value="telegram_test" />
                <button
                  type="submit"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  <FaPaperPlane className="text-xs" />
                  {t("admin_settings_telegram_test")}
                </button>
              </Form>
              <button
                type="submit"
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 transition-colors"
              >
                {t("save")}
              </button>
            </div>
          </Form>
        </div>
      </SectionCard>

      {/* ── Contract Warning ── */}
      <SectionCard
        icon={<FaShieldHalved />}
        title={t("admin_contract_warning_title")}
        subtitle={t("admin_contract_warning_desc")}
      >
        <Form method="post" className="grid sm:grid-cols-3 gap-4">
          <input type="hidden" name="intent" value="contract_warning" />
          {[
            { label: t("admin_contract_warning_first"), name: "first_days", value: contractWarningFirstDays },
            { label: t("admin_contract_warning_second"), name: "second_days", value: contractWarningSecondDays },
            { label: t("admin_contract_warning_third"), name: "third_days", value: contractWarningThirdDays },
          ].map((field) => (
            <div key={field.name} className="space-y-1.5">
              <label className="text-xs font-medium text-slate-600">{field.label}</label>
              <div className="relative">
                <input
                  name={field.name}
                  type="number"
                  min={0}
                  defaultValue={field.value}
                  className={fieldCls("pr-10")}
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500">วัน</span>
              </div>
            </div>
          ))}
          <div className="sm:col-span-3 flex justify-end">
            <button type="submit" className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 transition-colors">
              {t("save")}
            </button>
          </div>
        </Form>
      </SectionCard>

      {/* ── Ticket Reminder ── */}
      <SectionCard
        icon={<FaBell />}
        title={t("admin_ticket_reminder_title")}
        subtitle={t("admin_ticket_reminder_desc")}
      >
        {ticketReminderSaved && (
          <p className="flex items-center gap-2 text-xs text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 mb-4">
            <FaCircleCheck /> {t("admin_ticket_reminder_saved")}
          </p>
        )}
        <Form method="post" className="space-y-4">
          <input type="hidden" name="intent" value="ticket_reminder" />
          <label className="flex items-center gap-3 cursor-pointer select-none">
            <input
              type="checkbox"
              name="enabled"
              value="1"
              defaultChecked={ticketReminderEnabled}
              className="rounded border-slate-300 accent-violet-600"
            />
            <span className="text-sm text-slate-700">{t("admin_ticket_reminder_enabled")}</span>
          </label>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-600">{t("admin_ticket_reminder_days")}</label>
              <div className="relative">
                <input
                  name="days"
                  type="number"
                  min={1}
                  max={30}
                  defaultValue={ticketReminderDays}
                  className={fieldCls("pr-10")}
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500">วัน</span>
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-600">{t("admin_ticket_reminder_hour")}</label>
              <select
                name="hour"
                defaultValue={ticketReminderHour}
                className={fieldCls("bg-white")}
              >
                {Array.from({ length: 24 }, (_, i) => (
                  <option key={i} value={i}>{String(i).padStart(2, "0")}:00</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex justify-end">
            <button type="submit" className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 transition-colors">
              {t("save")}
            </button>
          </div>
        </Form>
      </SectionCard>

      {/* ── Portal Info ── */}
      <SectionCard icon={<FaCircleInfo />} title={t("admin_settings_portal_info")}>
        <div className="grid sm:grid-cols-2 gap-4">
          <InfoRow label={t("admin_settings_platform")} value="Cloudflare Workers + D1" />
          <InfoRow label={t("admin_settings_support_email")} value="aum@doaction.co.th" />
          <InfoRow label={t("admin_settings_version")} value="1.0.0" />
        </div>
      </SectionCard>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-slate-500">{label}</span>
      <span className="text-sm text-slate-700 font-medium">{value}</span>
    </div>
  );
}
