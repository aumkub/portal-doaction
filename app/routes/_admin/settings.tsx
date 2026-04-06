import { Form, redirect } from "react-router";
import { z } from "zod";
import { requireAdmin } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";
import PageHeader from "~/components/layout/PageHeader";
import { useT } from "~/lib/i18n";
import { sendTelegramNotification } from "~/lib/telegram.server";
import { FaCircleCheck, FaPaperPlane } from "react-icons/fa6";

export function meta() {
  return [{ title: "Settings — Admin" }];
}

const ProfileSchema = z.object({
  name: z.string().min(1, "Name is required"),
  intent: z.literal("profile"),
});

const TelegramSchema = z.object({
  telegram_bot_token: z.string().optional().default(""),
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
  const contractWarningFirstDays = Number(
    (await db.getAppSetting("contract_warning_first_days")) ?? "14"
  );
  const contractWarningSecondDays = Number(
    (await db.getAppSetting("contract_warning_second_days")) ?? "7"
  );
  const contractWarningThirdDays = Number(
    (await db.getAppSetting("contract_warning_third_days")) ?? "1"
  );
  const uptimeKey =
    (env as any).UPTIMEROBOT_API_KEY ?? "ur2618139-5281beb51ff9820a629669c2";
  const ticketReminderEnabled = (await db.getAppSetting("ticket_reminder_enabled")) !== "0";
  const ticketReminderDays = Number(
    (await db.getAppSetting("ticket_reminder_days")) ?? "1"
  );
  const ticketReminderHour = Number(
    (await db.getAppSetting("ticket_reminder_hour")) ?? "9"
  );
  return {
    admin,
    adminUsers,
    uptimeKey,
    telegramBotToken,
    contractWarningFirstDays,
    contractWarningSecondDays,
    contractWarningThirdDays,
    ticketReminderEnabled,
    ticketReminderDays,
    ticketReminderHour,
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
    if (!parsed.success) {
      return { errors: parsed.error.flatten().fieldErrors };
    }

    const token = parsed.data.telegram_bot_token.trim();
    if (token) {
      await db.setAppSetting("telegram_bot_token", token);
    } else {
      await db.deleteAppSetting("telegram_bot_token");
    }

    return redirect("/admin/settings");
  }

  if (intent === "contract_warning") {
    const parsed = ContractWarningSchema.safeParse(raw);
    if (!parsed.success) {
      return { errors: parsed.error.flatten().fieldErrors };
    }
    await db.setAppSetting("contract_warning_first_days", String(parsed.data.first_days));
    await db.setAppSetting("contract_warning_second_days", String(parsed.data.second_days));
    await db.setAppSetting("contract_warning_third_days", String(parsed.data.third_days));
    return redirect("/admin/settings");
  }

  if (intent === "ticket_reminder") {
    const parsed = TicketReminderSchema.safeParse(raw);
    if (!parsed.success) {
      return { errors: parsed.error.flatten().fieldErrors };
    }
    await db.setAppSetting("ticket_reminder_enabled", parsed.data.enabled === "1" ? "1" : "0");
    await db.setAppSetting("ticket_reminder_days", String(parsed.data.days));
    await db.setAppSetting("ticket_reminder_hour", String(parsed.data.hour));
    return { success: { ticket_reminder: true } };
  }

  if (intent === "telegram_test") {
    const token = await db.getAppSetting("telegram_bot_token");
    if (!token) {
      return { errors: { telegram_bot_token: ["Please set Telegram bot token first"] } };
    }

    await sendTelegramNotification({
      db,
      appUrl: env.APP_URL,
      notification: {
        title: "Test notification from do action portal",
        body: `Admin ${admin.name} sent a Telegram test message.`,
        link: "/admin/settings",
      },
    });

    return { success: { telegram: true } };
  }

  const parsed = ProfileSchema.safeParse(raw);
  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  await db.updateUser(admin.id, { name: parsed.data.name });
  return redirect("/admin/settings");
}

export default function AdminSettingsPage({ loaderData, actionData }: any) {
  const {
    admin,
    adminUsers,
    uptimeKey,
    telegramBotToken,
    contractWarningFirstDays,
    contractWarningSecondDays,
    contractWarningThirdDays,
    ticketReminderEnabled,
    ticketReminderDays,
    ticketReminderHour,
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
      <PageHeader
        title={t("admin_settings_title")}
        subtitle={t("admin_settings_subtitle")}
        breadcrumbs={[
          { label: t("admin_breadcrumb_admin") },
          { label: t("admin_settings_title") },
        ]}
      />

      {/* Profile */}
      <section className="bg-white rounded-xl border border-slate-200 p-6 space-y-5">
        <h2 className="text-sm font-semibold text-slate-900">
          {t("admin_settings_my_account")}
        </h2>
        <Form method="post" className="space-y-4">
          <input type="hidden" name="intent" value="profile" />
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-600">
                {t("admin_settings_name")}
              </label>
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
              <label className="text-xs font-medium text-slate-600">
                {t("admin_settings_email")}
              </label>
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
              {t("save")}
            </button>
          </div>
        </Form>
      </section>

      {/* Admin team */}
      <section className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
        <h2 className="text-sm font-semibold text-slate-900">
          {t("admin_settings_team")} ({adminUsers.length})
        </h2>
        <ul className="divide-y divide-slate-100">
          {adminUsers.map((u: any) => (
            <li key={u.id} className="flex items-center justify-between py-3">
              <div>
                <p className="text-sm font-medium text-slate-800">{u.name}</p>
                <p className="text-xs text-slate-400">{u.email}</p>
              </div>
              {u.id === admin.id && (
                <span className="text-xs text-slate-400">{t("admin_settings_you")}</span>
              )}
            </li>
          ))}
        </ul>
      </section>

      {/* Integrations */}
      <section className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
        <h2 className="text-sm font-semibold text-slate-900">
          {t("admin_settings_integrations")}
        </h2>
        <div className="rounded-lg border border-slate-100 bg-slate-50 p-4 space-y-2">
          <div className="flex items-center gap-2">
            <FaCircleCheck className="text-base text-emerald-500" aria-hidden="true" />
            <p className="text-sm font-medium text-slate-800">
              {t("admin_settings_uptime")}
            </p>
            <span className="ml-auto text-xs text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full font-medium">
              {t("admin_settings_connected")}
            </span>
          </div>
          <p className="text-xs text-slate-500">
            {t("admin_settings_uptime_desc")}
          </p>
          <div className="flex items-center gap-2 mt-2">
            <span className="text-xs text-slate-400 font-mono bg-white border border-slate-200 rounded px-2 py-1 select-all">
              {maskedKey}
            </span>
            <span className="text-xs text-slate-400">
              {t("admin_settings_api_key_note")}
            </span>
          </div>
        </div>
        <Form method="post" className="rounded-lg border border-slate-100 bg-slate-50 p-4 space-y-3">
          <input type="hidden" name="intent" value="telegram" />
          <div className="flex items-center gap-2">
            <FaPaperPlane className="text-base text-slate-700" aria-hidden="true" />
            <p className="text-sm font-medium text-slate-800">
              {t("admin_settings_telegram")}
            </p>
            {telegramBotToken ? (
              <span className="ml-auto text-xs text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full font-medium">
                {t("admin_settings_connected")}
              </span>
            ) : null}
          </div>
          <p className="text-xs text-slate-500">
            {t("admin_settings_telegram_desc")}
          </p>
          <input
            name="telegram_bot_token"
            type="text"
            defaultValue={telegramBotToken ?? ""}
            placeholder="123456789:AA..."
            className="w-full h-10 rounded-lg border border-slate-200 px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-slate-900"
          />
          {maskedTelegramToken ? (
            <p className="text-xs text-slate-400">
              {t("admin_settings_saved_token")}: <span className="font-mono">{maskedTelegramToken}</span>
            </p>
          ) : null}
          {errors?.telegram_bot_token ? (
            <p className="text-xs text-rose-600">{errors.telegram_bot_token[0]}</p>
          ) : null}
          {telegramTestSuccess ? (
            <p className="text-xs text-emerald-600">
              {t("admin_settings_telegram_test_sent")}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Form method="post">
              <input type="hidden" name="intent" value="telegram_test" />
              <button
                type="submit"
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 transition-colors"
              >
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
      </section>

      <section className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
        <h2 className="text-sm font-semibold text-slate-900">{t("admin_contract_warning_title")}</h2>
        <p className="text-xs text-slate-500">{t("admin_contract_warning_desc")}</p>
        <Form method="post" className="grid sm:grid-cols-3 gap-3">
          <input type="hidden" name="intent" value="contract_warning" />
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-600">{t("admin_contract_warning_first")}</label>
            <input
              name="first_days"
              type="number"
              min={0}
              defaultValue={contractWarningFirstDays}
              className="w-full h-10 rounded-lg border border-slate-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-600">{t("admin_contract_warning_second")}</label>
            <input
              name="second_days"
              type="number"
              min={0}
              defaultValue={contractWarningSecondDays}
              className="w-full h-10 rounded-lg border border-slate-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-600">{t("admin_contract_warning_third")}</label>
            <input
              name="third_days"
              type="number"
              min={0}
              defaultValue={contractWarningThirdDays}
              className="w-full h-10 rounded-lg border border-slate-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
            />
          </div>
          <div className="sm:col-span-3 flex justify-end">
            <button
              type="submit"
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 transition-colors"
            >
              {t("save")}
            </button>
          </div>
        </Form>
      </section>

      {/* Ticket reminder */}
      <section className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
        <h2 className="text-sm font-semibold text-slate-900">{t("admin_ticket_reminder_title")}</h2>
        <p className="text-xs text-slate-500">{t("admin_ticket_reminder_desc")}</p>
        {ticketReminderSaved && (
          <p className="text-xs text-emerald-600">{t("admin_ticket_reminder_saved")}</p>
        )}
        <Form method="post" className="space-y-4">
          <input type="hidden" name="intent" value="ticket_reminder" />
          {/* Enabled toggle */}
          <label className="flex items-center gap-3 cursor-pointer">
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
              <label className="text-xs font-medium text-slate-600">
                {t("admin_ticket_reminder_days")}
              </label>
              <input
                name="days"
                type="number"
                min={1}
                max={30}
                defaultValue={ticketReminderDays}
                className="w-full h-10 rounded-lg border border-slate-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-600">
                {t("admin_ticket_reminder_hour")}
              </label>
              <select
                name="hour"
                defaultValue={ticketReminderHour}
                className="w-full h-10 rounded-lg border border-slate-200 px-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-900"
              >
                {Array.from({ length: 24 }, (_, i) => (
                  <option key={i} value={i}>
                    {String(i).padStart(2, "0")}:00
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex justify-end">
            <button
              type="submit"
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 transition-colors"
            >
              {t("save")}
            </button>
          </div>
        </Form>
      </section>

      {/* Portal info */}
      <section className="bg-white rounded-xl border border-slate-200 p-6 space-y-3">
        <h2 className="text-sm font-semibold text-slate-900">
          {t("admin_settings_portal_info")}
        </h2>
        <div className="grid sm:grid-cols-2 gap-3">
          <InfoRow
            label={t("admin_settings_platform")}
            value="Cloudflare Workers + D1"
          />
          <InfoRow
            label={t("admin_settings_support_email")}
            value="aum@doaction.co.th"
          />
          <InfoRow label={t("admin_settings_version")} value="1.0.0" />
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
