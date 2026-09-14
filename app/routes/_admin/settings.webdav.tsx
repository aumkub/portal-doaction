import { Form, redirect, useLoaderData, useActionData, useNavigation } from "react-router";
import { z } from "zod";
import { requireAdmin } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";
import { useT } from "~/lib/i18n";
import {
  FaCloud,
  FaCircleCheck,
  FaCircleQuestion,
  FaPaperPlane,
  FaServer,
  FaFolderOpen,
  FaLock,
  FaToggleOn,
  FaToggleOff,
  FaSpinner,
} from "react-icons/fa6";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";

export function meta() {
  return [{ title: "WebDAV Backup Settings — Admin" }];
}

const WebDAVSchema = z.object({
  intent: z.literal("webdav"),
  enabled: z.string().optional().default("0"),
  label: z.string().optional(),
  url: z.string().url("Invalid URL").optional().or(z.literal("")),
  username: z.string().min(1, "Username is required").optional().or(z.literal("")),
  password: z.string().optional(),
  path: z.string().optional(),
});

const WebDAVTestSchema = z.object({
  intent: z.literal("webdav_test"),
});

export async function loader({ request, context }: any) {
  const env = context.cloudflare.env;
  const admin = await requireAdmin(request, env.DB, env.SESSIONPORTAL);
  const db = createDB(env.DB);

  const webdavEnabled = (await db.getAppSetting("webdav_enabled")) !== "0";
  const webdavLabel = (await db.getAppSetting("webdav_label")) ?? "";
  const webdavUrl = (await db.getAppSetting("webdav_url")) ?? "";
  const webdavUsername = (await db.getAppSetting("webdav_username")) ?? "";
  const webdavPath = (await db.getAppSetting("webdav_path")) ?? "";
  const webdavHasPassword = !!(await db.getAppSetting("webdav_password"));

  return {
    admin,
    webdavEnabled,
    webdavLabel,
    webdavUrl,
    webdavUsername,
    webdavPath,
    webdavHasPassword,
  };
}

export async function action({ request, context }: any) {
  const env = context.cloudflare.env;
  const admin = await requireAdmin(request, env.DB, env.SESSIONPORTAL);
  const db = createDB(env.DB);
  const formData = await request.formData();
  const raw = Object.fromEntries(formData);
  const intent = formData.get("intent");

  if (intent === "webdav") {
    const parsed = WebDAVSchema.safeParse(raw);
    if (!parsed.success) {
      return { errors: parsed.error.flatten().fieldErrors };
    }

    await db.setAppSetting("webdav_enabled", parsed.data.enabled === "1" ? "1" : "0");

    if (parsed.data.label) {
      await db.setAppSetting("webdav_label", parsed.data.label.trim());
    } else {
      await db.deleteAppSetting("webdav_label");
    }

    if (parsed.data.url) {
      await db.setAppSetting("webdav_url", parsed.data.url.trim());
    } else {
      await db.deleteAppSetting("webdav_url");
    }

    if (parsed.data.username) {
      await db.setAppSetting("webdav_username", parsed.data.username.trim());
    } else {
      await db.deleteAppSetting("webdav_username");
    }

    if (parsed.data.password) {
      await db.setAppSetting("webdav_password", parsed.data.password.trim());
    }

    if (parsed.data.path) {
      await db.setAppSetting("webdav_path", parsed.data.path.trim());
    } else {
      await db.deleteAppSetting("webdav_path");
    }

    return redirect("/admin/settings/webdav");
  }

  if (intent === "webdav_test") {
    const url = await db.getAppSetting("webdav_url");
    const username = await db.getAppSetting("webdav_username");
    const password = await db.getAppSetting("webdav_password");

    if (!url || !username || !password) {
      return { errors: { general: ["Please configure WebDAV settings first"] } };
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
        return { success: { connection: "successful" } };
      } else {
        return { errors: { general: [`Connection failed: ${response.status} ${response.statusText}`] } };
      }
    } catch (e: any) {
      return { errors: { general: [e.message || "Connection failed"] } };
    }
  }

  return { errors: { general: ["Invalid action"] } };
}

const inputCls = "w-full h-11 rounded-lg border border-slate-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-violet-500 transition";

export default function WebDAVSettingsPage() {
  const loaderData = useLoaderData();
  const actionData = useActionData();
  const {
    admin,
    webdavEnabled,
    webdavLabel,
    webdavUrl,
    webdavUsername,
    webdavPath,
    webdavHasPassword,
  } = loaderData;
  const { t } = useT();

  const errors = actionData?.errors;
  const saved = actionData?.success?.saved;
  const connectionSuccess = actionData?.success?.connection === "successful";
  const navigation = useNavigation();
  const isTesting = navigation.state === "submitting" && navigation.formData?.get("intent") === "webdav_test";

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-2">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-100 text-sky-600">
            <FaCloud className="text-lg" />
          </span>
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">{t("admin_webdav_title")}</h1>
            <p className="text-sm text-slate-500 mt-0.5">{t("admin_webdav_desc")}</p>
          </div>
        </div>
      </div>

      {/* Status Card */}
      <div className={`rounded-xl border p-5 ${
        webdavEnabled
          ? "bg-emerald-50 border-emerald-200"
          : "bg-slate-50 border-slate-200"
      }`}>
        <div className="flex items-center gap-3">
          <span className={`flex h-10 w-10 items-center justify-center rounded-lg ${
            webdavEnabled
              ? "bg-emerald-100 text-emerald-600"
              : "bg-slate-200 text-slate-500"
          }`}>
            {webdavEnabled ? <FaCircleCheck /> : <FaCloud />}
          </span>
          <div>
            <p className={`font-semibold ${
              webdavEnabled
                ? "text-emerald-900"
                : "text-slate-700"
            }`}>
              {webdavEnabled
                ? "WebDAV Backup is Enabled"
                : "WebDAV Backup is Disabled"}
            </p>
            <p className="text-xs mt-0.5">
              {webdavEnabled
                ? "Backups will be uploaded to your WebDAV server"
                : "Enable to start using cloud WebDAV backup"}
            </p>
          </div>
        </div>
      </div>

      {/* Settings Form */}
      <Form method="post" className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <input type="hidden" name="intent" value="webdav" />

        <div className="px-6 py-5 border-b border-slate-100">
          <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <FaServer className="text-slate-400" />
            WebDAV Configuration
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            Configure your WebDAV server settings (Nextcloud, ownCloud, etc.)
          </p>
        </div>

        <div className="p-6 space-y-6">
          {/* Enable Toggle */}
          <div className="flex items-center justify-between p-4 rounded-lg border border-slate-200 bg-slate-50">
            <div className="flex items-center gap-3">
              <span className={`text-2xl ${webdavEnabled ? "text-emerald-500" : "text-slate-400"}`}>
                {webdavEnabled ? <FaToggleOn /> : <FaToggleOff />}
              </span>
              <div>
                <p className="font-medium text-slate-900">{t("admin_webdav_enabled")}</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  Enable automatic WebDAV backups
                </p>
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                name="enabled"
                value="1"
                defaultChecked={webdavEnabled}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-violet-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-violet-600"></div>
            </label>
          </div>

          {/* Label */}
          <div className="space-y-2">
            <Label htmlFor="webdav_label" className="flex items-center gap-2">
              <FaServer className="text-slate-400 text-sm" />
              {t("admin_webdav_label")} <span className="text-slate-400 font-normal">(optional)</span>
            </Label>
            <Input
              id="webdav_label"
              name="label"
              type="text"
              defaultValue={webdavLabel}
              placeholder="Production Backup"
            />
            <p className="text-xs text-slate-500">
              A friendly name to identify this WebDAV connection
            </p>
            {errors?.label && (
              <p className="text-xs text-rose-600 flex items-center gap-1">
                <span>⚠️</span> {errors.label[0]}
              </p>
            )}
          </div>

          {/* URL */}
          <div className="space-y-2">
            <Label htmlFor="webdav_url" className="flex items-center gap-2">
              <FaCloud className="text-slate-400 text-sm" />
              {t("admin_webdav_url")} <span className="text-rose-500">*</span>
            </Label>
            <Input
              id="webdav_url"
              name="url"
              type="url"
              defaultValue={webdavUrl}
              placeholder="https://cloud.example.com/remote.php/webdav/"
              className="font-mono"
            />
            <p className="text-xs text-slate-500">
              WebDAV endpoint URL. For Nextcloud: <code className="bg-slate-100 px-1 py-0.5 rounded">https://cloud.example.com/remote.php/webdav/</code>
            </p>
            {errors?.url && (
              <p className="text-xs text-rose-600 flex items-center gap-1">
                <span>⚠️</span> {errors.url[0]}
              </p>
            )}
          </div>

          {/* Username & Password */}
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="webdav_username" className="flex items-center gap-2">
                <FaServer className="text-slate-400 text-sm" />
                {t("admin_webdav_username")} <span className="text-rose-500">*</span>
              </Label>
              <Input
                id="webdav_username"
                name="username"
                type="text"
                defaultValue={webdavUsername}
                placeholder="your-username"
              />
              {errors?.username && (
                <p className="text-xs text-rose-600 flex items-center gap-1">
                  <span>⚠️</span> {errors.username[0]}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="webdav_password" className="flex items-center gap-2">
                <FaLock className="text-slate-400 text-sm" />
                {t("admin_webdav_password")}
              </Label>
              <Input
                id="webdav_password"
                name="password"
                type="password"
                placeholder={webdavHasPassword ? "••••••••" : ""}
              />
              <p className="text-xs text-slate-500">
                {t("admin_webdav_password_hint")}
              </p>
              {errors?.password && (
                <p className="text-xs text-rose-600 flex items-center gap-1">
                  <span>⚠️</span> {errors.password[0]}
                </p>
              )}
            </div>
          </div>

          {/* Base Path */}
          <div className="space-y-2">
            <Label htmlFor="webdav_path" className="flex items-center gap-2">
              <FaFolderOpen className="text-slate-400 text-sm" />
              {t("admin_webdav_path")} <span className="text-slate-400 font-normal">(optional)</span>
            </Label>
            <Input
              id="webdav_path"
              name="path"
              type="text"
              defaultValue={webdavPath}
              placeholder="/backups"
              className="font-mono"
            />
            <p className="text-xs text-slate-500">
              Base path on WebDAV server where backups will be stored
            </p>
            {errors?.path && (
              <p className="text-xs text-rose-600 flex items-center gap-1">
                <span>⚠️</span> {errors.path[0]}
              </p>
            )}
          </div>

          {/* Messages */}
          {saved && (
            <div className="flex items-center gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
              <FaCircleCheck className="text-emerald-600" />
              <p className="text-sm font-medium text-emerald-800">{t("admin_webdav_saved")}</p>
            </div>
          )}

          {connectionSuccess && (
            <div className="flex items-center gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
              <FaCircleCheck className="text-emerald-600" />
              <p className="text-sm font-medium text-emerald-800">{t("admin_webdav_test_success")}</p>
            </div>
          )}

          {errors?.general && (
            <div className="flex items-start gap-2 p-3 bg-rose-50 border border-rose-200 rounded-lg">
              <span className="text-rose-600 mt-0.5">⚠️</span>
              <p className="text-sm text-rose-800">{errors.general[0]}</p>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
          <Form method="post">
            <input type="hidden" name="intent" value="webdav_test" />
            <Button
              type="submit"
              variant="outline"
              className="border-slate-300 hover:bg-slate-100"
              disabled={isTesting}
            >
              {isTesting ? (
                <>
                  <FaSpinner className="mr-2 text-xs animate-spin" />
                  {t("admin_webdav_test")}...
                </>
              ) : (
                <>
                  <FaPaperPlane className="mr-2 text-xs" />
                  {t("admin_webdav_test")}
                </>
              )}
            </Button>
          </Form>
          <Button type="submit" className="bg-violet-600 hover:bg-violet-700">
            {t("save")}
          </Button>
        </div>
      </Form>

      {/* Help Section */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h3 className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-2">
          <FaCircleQuestion className="text-slate-400" />
          Help & Documentation
        </h3>
        <div className="space-y-2 text-sm text-slate-600">
          <p>
            <strong>Nextcloud:</strong> Enable WebDAV in Settings → Administration → Sharing
          </p>
          <p>
            <strong>ownCloud:</strong> WebDAV is enabled by default at <code className="bg-slate-100 px-1 py-0.5 rounded">/remote.php/webdav/</code>
          </p>
          <p>
            <strong>Path:</strong> Use <code className="bg-slate-100 px-1 py-0.5 rounded">/backups</code> to organize all client backups in one folder
          </p>
        </div>
      </div>
    </div>
  );
}