import { Form, Link, redirect, useSearchParams } from "react-router";
import { sendDigestPreview } from "~/lib/email-alerts.server";
import { getUptimeRobotKey } from "~/lib/secrets.server";
import { z } from "zod";
import { requireAdmin, evictUserCache } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";
import { useT } from "~/lib/i18n";
import { sendTelegramNotification } from "~/lib/telegram.server";
import { NativeSelect } from "~/components/ui/native-select";
import {
  FaCircleCheck,
  FaPaperPlane,
  FaEnvelope,
  FaUser,
  FaUsers,
  FaPlug,
  FaShieldHalved,
  FaBell,
  FaCircleInfo,
  FaTelegram,
  FaCloud,
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

const EmailDigestSchema = z.object({
  intent: z.literal("email_digest"),
  enabled: z.string().optional().default("0"),
  hour: z.coerce.number().int().min(0).max(23).default(8),
});

const WebDAVSchema = z.object({
  intent: z.literal("webdav"),
  enabled: z.string().optional().default("0"),
  url: z.string().optional().default(""),
  username: z.string().optional().default(""),
  password: z.string().optional().default(""),
  path: z.string().optional().default(""),
});

const WebDAVTestSchema = z.object({
  intent: z.literal("webdav_test"),
});

export async function loader({ request, context }: any) {
  const env = context.cloudflare.env;
  const admin = await requireAdmin(request, env.DB, env.SESSIONPORTAL);
  const db = createDB(env.DB);
  const [adminUsers, s] = await Promise.all([
    db.listAdminUsers(),
    db.getAppSettings([
      "telegram_bot_token",
      "telegram_default_group_id",
      "contract_warning_first_days",
      "contract_warning_second_days",
      "contract_warning_third_days",
      "ticket_reminder_enabled",
      "ticket_reminder_days",
      "ticket_reminder_hour",
      "email_digest_enabled",
      "email_digest_hour",
      "email_digest_last_date",
      "webdav_enabled",
      "webdav_url",
      "webdav_username",
      "webdav_path",
      "webdav_password",
    ]),
  ]);
  const telegramBotToken = s.telegram_bot_token;
  const telegramDefaultGroupId = s.telegram_default_group_id;
  const contractWarningFirstDays = Number(s.contract_warning_first_days ?? "14");
  const contractWarningSecondDays = Number(s.contract_warning_second_days ?? "7");
  const contractWarningThirdDays = Number(s.contract_warning_third_days ?? "1");
  // Only a masked form of the key ever reaches the browser.
  const rawUptimeKey = getUptimeRobotKey(env) ?? "";
  const uptimeKey =
    rawUptimeKey.length > 12
      ? `${rawUptimeKey.slice(0, 6)}${"•".repeat(rawUptimeKey.length - 12)}${rawUptimeKey.slice(-6)}`
      : "•".repeat(rawUptimeKey.length);
  const ticketReminderEnabled = s.ticket_reminder_enabled !== "0";
  const ticketReminderDays = Number(s.ticket_reminder_days ?? "1");
  const ticketReminderHour = Number(s.ticket_reminder_hour ?? "9");
  const emailDigestEnabled = s.email_digest_enabled !== "0";
  const emailDigestHour = Number(s.email_digest_hour ?? "8");
  const emailDigestLastDate = s.email_digest_last_date ?? null;
  const webdavEnabled = s.webdav_enabled !== "0";
  const webdavUrl = s.webdav_url ?? "";
  const webdavUsername = s.webdav_username ?? "";
  const webdavPath = s.webdav_path ?? "";
  const webdavHasPassword = !!s.webdav_password;
  return {
    admin, adminUsers, uptimeKey,
    telegramBotToken, telegramDefaultGroupId,
    contractWarningFirstDays, contractWarningSecondDays, contractWarningThirdDays,
    ticketReminderEnabled, ticketReminderDays, ticketReminderHour,
    emailDigestEnabled, emailDigestHour, emailDigestLastDate,
    webdavEnabled, webdavUrl, webdavUsername, webdavPath, webdavHasPassword,
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

  if (intent === "email_digest") {
    const parsed = EmailDigestSchema.safeParse(raw);
    if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };
    await db.setAppSetting("email_digest_enabled", parsed.data.enabled === "1" ? "1" : "0");
    await db.setAppSetting("email_digest_hour", String(parsed.data.hour));
    return { success: { email_digest: true } };
  }

  if (intent === "email_digest_test") {
    const sent = await sendDigestPreview(env, { email: admin.email, name: admin.name });
    return sent
      ? { success: { email_digest_test: admin.email } }
      : { success: { email_digest_empty: true } };
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

  if (intent === "webdav") {
    const parsed = WebDAVSchema.safeParse(raw);
    if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };
    await db.setAppSetting("webdav_enabled", parsed.data.enabled === "1" ? "1" : "0");
    const url = parsed.data.url.trim();
    if (url) await db.setAppSetting("webdav_url", url);
    else await db.deleteAppSetting("webdav_url");
    const username = parsed.data.username.trim();
    if (username) await db.setAppSetting("webdav_username", username);
    else await db.deleteAppSetting("webdav_username");
    const password = parsed.data.password.trim();
    if (password) await db.setAppSetting("webdav_password", password);
    const path = parsed.data.path.trim();
    if (path) await db.setAppSetting("webdav_path", path);
    else await db.deleteAppSetting("webdav_path");
    return { success: { webdav: true } };
  }

  if (intent === "webdav_test") {
    const url = await db.getAppSetting("webdav_url");
    const username = await db.getAppSetting("webdav_username");
    const password = await db.getAppSetting("webdav_password");
    if (!url || !username || !password) {
      return { errors: { webdav: ["Please configure WebDAV settings first"] } };
    }
    try {
      const webdavUrl = new URL(url);
      const response = await fetch(webdavUrl.toString(), {
        method: "PROPFIND",
        headers: {
          "Authorization": `Basic ${btoa(`${username}:${password}`)}`,
          "Depth": "0",
        },
      });
      if (response.ok) {
        return { success: { webdav_test: true } };
      } else {
        return { errors: { webdav: [`Connection failed: ${response.status} ${response.statusText}`] } };
      }
    } catch (e: any) {
      return { errors: { webdav: [e.message || "Connection failed"] } };
    }
  }

  const parsed = ProfileSchema.safeParse(raw);
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };
  await db.updateUser(admin.id, { name: parsed.data.name });
  await evictUserCache(env.SESSIONPORTAL, admin.id);
  return redirect("/admin/settings");
}

function SectionCard({ icon, title, subtitle, children }: {
  icon: React.ReactNode; title: string; subtitle?: string; children: React.ReactNode;
}) {
  return (
    <section className="bg-white rounded-[20px] border border-line overflow-hidden">
      <div className="flex items-center gap-3 px-6 py-5 border-b border-line-soft">
        <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-paper text-ink shrink-0 text-sm">
          {icon}
        </span>
        <div>
          <p className="text-[16px] font-semibold text-ink">{title}</p>
          {subtitle && <p className="text-xs text-muted-ink mt-0.5">{subtitle}</p>}
        </div>
      </div>
      <div className="p-6">{children}</div>
    </section>
  );
}

function fieldCls(extra = "") {
  return `w-full h-10 rounded-xl border border-line bg-white px-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-ink/10 focus:border-ink/40 transition ${extra}`;
}

export default function AdminSettingsPage({ loaderData, actionData }: any) {
  const {
    admin, adminUsers, uptimeKey,
    telegramBotToken, telegramDefaultGroupId,
    contractWarningFirstDays, contractWarningSecondDays, contractWarningThirdDays,
    ticketReminderEnabled, ticketReminderDays, ticketReminderHour,
    emailDigestEnabled, emailDigestHour, emailDigestLastDate,
    webdavEnabled, webdavUrl, webdavUsername, webdavPath, webdavHasPassword,
  } = loaderData;
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get("tab") ?? "account";
  const errors = actionData?.errors;
  const telegramTestSuccess = Boolean(actionData?.success?.telegram);
  const ticketReminderSaved = Boolean(actionData?.success?.ticket_reminder);
  const emailDigestSaved = Boolean(actionData?.success?.email_digest);
  const emailDigestTestTo: string | undefined = actionData?.success?.email_digest_test;
  const emailDigestEmpty = Boolean(actionData?.success?.email_digest_empty);
  const webdavSaved = Boolean(actionData?.success?.webdav);
  const webdavTestSuccess = Boolean(actionData?.success?.webdav_test);
  const { t, lang } = useT();

  const tabs = [
    { id: "account", label: lang === "th" ? "บัญชี" : "Account", icon: <FaUser className="text-[10px]" /> },
    { id: "integrations", label: lang === "th" ? "การเชื่อมต่อ" : "Integrations", icon: <FaPlug className="text-[10px]" /> },
    { id: "notifications", label: lang === "th" ? "การแจ้งเตือน" : "Notifications", icon: <FaBell className="text-[10px]" /> },
    { id: "system", label: lang === "th" ? "ระบบ" : "System", icon: <FaCircleInfo className="text-[10px]" /> },
  ];

  const maskedKey = uptimeKey;
  const maskedTelegramToken = telegramBotToken
    ? telegramBotToken.length > 12
      ? `${telegramBotToken.slice(0, 6)}${"•".repeat(telegramBotToken.length - 12)}${telegramBotToken.slice(-6)}`
      : "•".repeat(telegramBotToken.length)
    : "";

  return (
    <div className="space-y-6 max-w-4xl">
      {/* ── Page header ── */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[28px] md:text-[32px] font-bold tracking-[-0.02em] text-ink">{t("admin_settings_title")}</h1>
          <p className="text-muted-ink text-sm mt-0.5">{t("admin_settings_subtitle")}</p>
        </div>
        <Link
          to="/admin/settings/mcp"
          className="shrink-0 inline-flex h-10 items-center rounded-full border border-line bg-white px-5 text-[13px] font-semibold text-ink hover:bg-paper"
        >
          MCP / Claude
        </Link>
      </div>

      {/* ── Tab Navigation ── */}
      <div className="flex max-w-full overflow-x-auto rounded-full bg-[#ECEAE3] p-[3px] gap-0.5 w-fit">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setSearchParams({ tab: tab.id })}
            className={`flex shrink-0 items-center gap-2 h-9 px-4 rounded-full text-[13px] font-medium transition-all ${
              activeTab === tab.id
                ? "bg-white text-ink shadow-[0_1px_2px_rgba(0,0,0,0.08)]"
                : "text-muted-ink hover:text-ink"
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Tab Content ── */}
      {activeTab === "account" && (
        <div className="space-y-6">
          {/* ── My Account ── */}
          <SectionCard icon={<FaUser />} title={t("admin_settings_my_account")}>
            <Form method="post" className="space-y-4">
              <input type="hidden" name="intent" value="profile" />
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-ink-soft">{t("admin_settings_name")}</label>
                  <input name="name" defaultValue={admin.name} required className={fieldCls()} />
                  {errors?.name && <p className="text-xs text-red-500">{errors.name[0]}</p>}
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-ink-soft">{t("admin_settings_email")}</label>
                  <input value={admin.email} readOnly className={fieldCls("bg-paper text-muted-ink cursor-not-allowed")} />
                </div>
              </div>
              <div className="flex justify-end">
                <button type="submit" className="inline-flex h-10 items-center rounded-full bg-ink px-5 text-[13px] font-semibold text-white hover:bg-black transition-colors">
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
            <ul className="divide-y divide-line-soft -my-1">
              {adminUsers.map((u: any) => (
                <li key={u.id} className="flex items-center justify-between py-3">
                  <div>
                    <p className="text-sm font-medium text-ink">{u.name}</p>
                    <p className="text-xs text-muted-ink">{u.email}</p>
                  </div>
                  {u.id === admin.id && (
                    <span className="text-xs font-medium text-ink-soft bg-paper px-2 py-0.5 rounded-md ring-1 ring-inset ring-line">
                      {t("admin_settings_you")}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </SectionCard>
        </div>
      )}

      {activeTab === "integrations" && (
        <div className="space-y-6">
          {/* ── Integrations ── */}
          <SectionCard icon={<FaPlug />} title={t("admin_settings_integrations")} subtitle="เชื่อมต่อบริการภายนอก">
            <div className="space-y-4">
              {/* Uptime Robot */}
              <div className="rounded-[14px] border border-line-soft bg-paper p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <FaCircleCheck className="text-emerald-500 shrink-0" />
                  <p className="text-sm font-medium text-ink">{t("admin_settings_uptime")}</p>
                  <span className="ml-auto text-xs text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md font-medium ring-1 ring-inset ring-emerald-600/20">
                    {t("admin_settings_connected")}
                  </span>
                </div>
                <p className="text-xs text-muted-ink">{t("admin_settings_uptime_desc")}</p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs text-muted-ink font-mono bg-white border border-line rounded-[14px] px-3 py-1.5 select-all">
                    {maskedKey}
                  </span>
                  <span className="text-xs text-muted-ink">{t("admin_settings_api_key_note")}</span>
                </div>
              </div>

              {/* Telegram */}
              <Form method="post" className="rounded-[14px] border border-line-soft bg-paper p-4 space-y-4">
                <input type="hidden" name="intent" value="telegram" />
                <div className="flex items-center gap-2">
                  <FaTelegram className="text-[#229ED9] shrink-0" />
                  <p className="text-sm font-medium text-ink">{t("admin_settings_telegram")}</p>
                  {telegramBotToken && (
                    <span className="ml-auto text-xs text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md font-medium ring-1 ring-inset ring-emerald-600/20">
                      {t("admin_settings_connected")}
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-ink">{t("admin_settings_telegram_desc")}</p>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-ink-soft">Bot Token</label>
                  <input
                    name="telegram_bot_token"
                    type="text"
                    defaultValue={telegramBotToken ?? ""}
                    placeholder="123456789:AA..."
                    className={fieldCls("font-mono")}
                  />
                  {maskedTelegramToken && (
                    <p className="text-xs text-muted-ink">
                      {t("admin_settings_saved_token")}: <span className="font-mono">{maskedTelegramToken}</span>
                    </p>
                  )}
                  {errors?.telegram_bot_token && (
                    <p className="text-xs text-rose-600">{errors.telegram_bot_token[0]}</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-ink-soft">
                    Default Group ID <span className="text-muted-ink font-normal">(optional)</span>
                  </label>
                  <p className="text-xs text-muted-ink">
                    กลุ่มเริ่มต้นที่จะใช้ส่งการแจ้งเตือนเมื่อ Co-Admin ไม่ได้ระบุ Group ID เฉพาะ
                  </p>
                  <input
                    name="telegram_default_group_id"
                    type="text"
                    defaultValue={telegramDefaultGroupId ?? ""}
                    placeholder="-1004487258170:5 หรือ https://t.me/c/4487258170/5"
                    className={fieldCls("font-mono")}
                  />
                  {errors?.telegram_default_group_id && (
                    <p className="text-xs text-rose-600 mt-1">{errors.telegram_default_group_id[0]}</p>
                  )}
                </div>

                {telegramTestSuccess && (
                  <p className="flex items-center gap-2 text-xs text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-[14px] px-3 py-2">
                    <FaCircleCheck /> {t("admin_settings_telegram_test_sent")}
                  </p>
                )}

                <div className="flex justify-end gap-2 pt-1">
                  <Form method="post">
                    <input type="hidden" name="intent" value="telegram_test" />
                    <button
                      type="submit"
                      className="inline-flex items-center gap-1.5 h-10 rounded-full border border-line bg-white px-5 text-[13px] font-semibold text-ink hover:bg-paper transition-colors"
                    >
                      <FaPaperPlane className="text-xs" />
                      {t("admin_settings_telegram_test")}
                    </button>
                  </Form>
                  <button
                    type="submit"
                    className="inline-flex h-10 items-center rounded-full bg-ink px-5 text-[13px] font-semibold text-white hover:bg-black transition-colors"
                  >
                    {t("save")}
                  </button>
                </div>
              </Form>

              {/* WebDAV Backup */}
              <Form method="post" className="rounded-[14px] border border-line-soft bg-paper p-4 space-y-4">
                <input type="hidden" name="intent" value="webdav" />
                <div className="flex items-center gap-2">
                  <FaCloud className="text-sky-500 shrink-0" />
                  <p className="text-sm font-medium text-ink">{t("admin_webdav_title")}</p>
                  {webdavEnabled && (
                    <span className="ml-auto text-xs text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md font-medium ring-1 ring-inset ring-emerald-600/20">
                      {t("admin_settings_connected")}
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-ink">{t("admin_webdav_desc")}</p>

                <label className="flex items-center gap-3 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    name="enabled"
                    value="1"
                    defaultChecked={webdavEnabled}
                    className="h-4 w-4 rounded border-line accent-[#111]"
                  />
                  <span className="text-sm text-ink-soft">{t("admin_webdav_enabled")}</span>
                </label>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-ink-soft">{t("admin_webdav_url")}</label>
                  <input
                    name="url"
                    type="url"
                    defaultValue={webdavUrl ?? ""}
                    placeholder={t("admin_webdav_url_placeholder")}
                    className={fieldCls("font-mono")}
                  />
                  {errors?.url && <p className="text-xs text-rose-600">{errors.url[0]}</p>}
                </div>

                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-ink-soft">{t("admin_webdav_username")}</label>
                    <input
                      name="username"
                      type="text"
                      defaultValue={webdavUsername ?? ""}
                      className={fieldCls()}
                    />
                    {errors?.username && <p className="text-xs text-rose-600">{errors.username[0]}</p>}
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-ink-soft">{t("admin_webdav_password")}</label>
                    <input
                      name="password"
                      type="password"
                      placeholder={webdavHasPassword ? "•••••••••" : ""}
                      className={fieldCls()}
                    />
                    <p className="text-xs text-muted-ink">{t("admin_webdav_password_hint")}</p>
                    {errors?.password && <p className="text-xs text-rose-600">{errors.password[0]}</p>}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-ink-soft">{t("admin_webdav_path")}</label>
                  <input
                    name="path"
                    type="text"
                    defaultValue={webdavPath ?? ""}
                    placeholder={t("admin_webdav_path_placeholder")}
                    className={fieldCls("font-mono")}
                  />
                  {errors?.path && <p className="text-xs text-rose-600">{errors.path[0]}</p>}
                </div>

                {webdavSaved && (
                  <p className="flex items-center gap-2 text-xs text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-[14px] px-3 py-2">
                    <FaCircleCheck /> {t("admin_webdav_saved")}
                  </p>
                )}

                {webdavTestSuccess && (
                  <p className="flex items-center gap-2 text-xs text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-[14px] px-3 py-2">
                    <FaCircleCheck /> {t("admin_webdav_test_success")}
                  </p>
                )}

                {errors?.webdav && (
                  <p className="flex items-center gap-2 text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-[14px] px-3 py-2">
                    {errors.webdav[0]}
                  </p>
                )}

                <div className="flex justify-end gap-2 pt-1">
                  <Form method="post">
                    <input type="hidden" name="intent" value="webdav_test" />
                    <button
                      type="submit"
                      className="inline-flex items-center gap-1.5 h-10 rounded-full border border-line bg-white px-5 text-[13px] font-semibold text-ink hover:bg-paper transition-colors"
                    >
                      <FaPaperPlane className="text-xs" />
                      {t("admin_webdav_test")}
                    </button>
                  </Form>
                  <button
                    type="submit"
                    className="inline-flex h-10 items-center rounded-full bg-ink px-5 text-[13px] font-semibold text-white hover:bg-black transition-colors"
                  >
                    {t("save")}
                  </button>
                </div>
              </Form>
            </div>
          </SectionCard>
        </div>
      )}

      {activeTab === "notifications" && (
        <div className="space-y-6">
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
                  <label className="text-xs font-medium text-ink-soft">{field.label}</label>
                  <div className="relative">
                    <input
                      name={field.name}
                      type="number"
                      min={0}
                      defaultValue={field.value}
                      className={fieldCls("pr-10")}
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-ink">วัน</span>
                  </div>
                </div>
              ))}
              <div className="sm:col-span-3 flex justify-end">
                <button type="submit" className="inline-flex h-10 items-center rounded-full bg-ink px-5 text-[13px] font-semibold text-white hover:bg-black transition-colors">
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
              <p className="flex items-center gap-2 text-xs text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-[14px] px-3 py-2 mb-4">
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
                  className="h-4 w-4 rounded border-line accent-[#111]"
                />
                <span className="text-sm text-ink-soft">{t("admin_ticket_reminder_enabled")}</span>
              </label>
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-ink-soft">{t("admin_ticket_reminder_days")}</label>
                  <div className="relative">
                    <input
                      name="days"
                      type="number"
                      min={1}
                      max={30}
                      defaultValue={ticketReminderDays}
                      className={fieldCls("pr-10")}
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-ink">วัน</span>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-ink-soft">{t("admin_ticket_reminder_hour")}</label>
                  <NativeSelect name="hour" defaultValue={ticketReminderHour} className="bg-white">
                    {Array.from({ length: 24 }, (_, i) => (
                      <option key={i} value={i}>{String(i).padStart(2, "0")}:00</option>
                    ))}
                  </NativeSelect>
                </div>
              </div>
              <div className="flex justify-end">
                <button type="submit" className="inline-flex h-10 items-center rounded-full bg-ink px-5 text-[13px] font-semibold text-white hover:bg-black transition-colors">
                  {t("save")}
                </button>
              </div>
            </Form>
          </SectionCard>

          {/* ── Daily email digest ── */}
          <SectionCard
            icon={<FaEnvelope />}
            title={lang === "en" ? "Daily email digest" : "อีเมลสรุปรายวัน"}
            subtitle={
              lang === "en"
                ? "One email a day to the admin team: open tickets, unsent reports, clients still missing this month's report (from the 20th) and contracts ending within 30 days. Skipped on days with nothing to report."
                : "ส่งวันละฉบับถึงทีมแอดมิน: Ticket ค้าง, รายงานที่ยังไม่ส่ง, ลูกค้าที่ยังไม่มีรายงาน (ตั้งแต่วันที่ 20) และสัญญาที่จะหมดใน 30 วัน — วันที่ไม่มีอะไรจะไม่ส่ง"
            }
          >
            {emailDigestSaved && (
              <p className="flex items-center gap-2 text-xs text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-[14px] px-3 py-2 mb-4">
                <FaCircleCheck /> {lang === "en" ? "Saved" : "บันทึกแล้ว"}
              </p>
            )}
            {emailDigestTestTo && (
              <p className="flex items-center gap-2 text-xs text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-[14px] px-3 py-2 mb-4">
                <FaCircleCheck /> {lang === "en" ? `Test digest sent to ${emailDigestTestTo}` : `ส่งอีเมลทดสอบไปที่ ${emailDigestTestTo} แล้ว`}
              </p>
            )}
            {emailDigestEmpty && (
              <p className="text-xs text-muted-ink bg-paper rounded-[14px] px-3 py-2 mb-4">
                {lang === "en" ? "Nothing to report today, so no email was sent." : "วันนี้ไม่มีเรื่องต้องแจ้ง จึงไม่ได้ส่งอีเมล"}
              </p>
            )}
            <Form method="post" className="space-y-4">
              <input type="hidden" name="intent" value="email_digest" />
              <label className="flex items-center gap-3 cursor-pointer select-none">
                <input
                  type="checkbox"
                  name="enabled"
                  value="1"
                  defaultChecked={emailDigestEnabled}
                  className="h-4 w-4 rounded border-line accent-[#111]"
                />
                <span className="text-sm text-ink-soft">{lang === "en" ? "Send the daily digest" : "เปิดใช้อีเมลสรุปรายวัน"}</span>
              </label>
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label htmlFor="email_digest_hour" className="text-xs font-medium text-ink-soft">
                    {lang === "en" ? "Send at (Bangkok time)" : "เวลาส่ง (เวลาไทย)"}
                  </label>
                  <NativeSelect id="email_digest_hour" name="hour" defaultValue={emailDigestHour} className="bg-white">
                    {Array.from({ length: 24 }, (_, i) => (
                      <option key={i} value={i}>{String(i).padStart(2, "0")}:00</option>
                    ))}
                  </NativeSelect>
                </div>
                <div className="space-y-1.5">
                  <span className="text-xs font-medium text-ink-soft">{lang === "en" ? "Last sent" : "ส่งล่าสุด"}</span>
                  <p className="h-10 flex items-center text-sm text-muted-ink">{emailDigestLastDate ?? "—"}</p>
                </div>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <button type="submit" className="inline-flex h-10 items-center rounded-full bg-ink px-5 text-[13px] font-semibold text-white hover:bg-black transition-colors">
                  {t("save")}
                </button>
              </div>
            </Form>
            <Form method="post" className="mt-3 flex justify-end">
              <input type="hidden" name="intent" value="email_digest_test" />
              <button type="submit" className="inline-flex h-10 items-center gap-2 rounded-full border border-line bg-white px-5 text-[13px] font-semibold text-ink hover:bg-paper transition-colors">
                <FaPaperPlane className="text-xs" aria-hidden="true" />
                {lang === "en" ? `Send a test to ${admin.email}` : `ส่งทดสอบไปที่ ${admin.email}`}
              </button>
            </Form>
          </SectionCard>
        </div>
      )}

      {activeTab === "system" && (
        <div className="space-y-6">
          {/* ── Portal Info ── */}
          <SectionCard icon={<FaCircleInfo />} title={t("admin_settings_portal_info")}>
            <div className="grid sm:grid-cols-2 gap-4">
              <InfoRow label={t("admin_settings_platform")} value="Cloudflare Workers + D1" />
              <InfoRow label={t("admin_settings_support_email")} value="aum@doaction.co.th" />
              <InfoRow label={t("admin_settings_version")} value="1.0.0" />
            </div>
          </SectionCard>
        </div>
      )}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-ink">{label}</span>
      <span className="text-sm text-ink-soft font-medium">{value}</span>
    </div>
  );
}