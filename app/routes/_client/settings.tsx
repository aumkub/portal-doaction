import { Form, redirect } from "react-router";
import { z } from "zod";
import { requireUser } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";
import { useT } from "~/lib/i18n";
import { FaUser, FaBuilding, FaCircleQuestion, FaTicket } from "react-icons/fa6";

export function meta() {
  return [{ title: "Settings — do action portal" }];
}

const ProfileSchema = z.object({
  name: z.string().min(1, "กรุณากรอกชื่อ"),
});

const packageStyles = {
  basic:    "bg-slate-100 text-slate-600 ring-1 ring-slate-200",
  standard: "bg-blue-50 text-blue-700 ring-1 ring-blue-200",
  premium:  "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
};

const packageLabels = {
  basic: "Basic",
  standard: "Standard",
  premium: "Premium",
};

function getInitials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

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
  const parsed = ProfileSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors };
  await db.updateUser(user.id, { name: parsed.data.name });
  return redirect("/settings");
}

const inputCls = "w-full h-10 rounded-lg border border-slate-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400 focus:border-violet-400 transition";

export default function ClientSettingsPage({ loaderData, actionData }: any) {
  const { user, client } = loaderData;
  const errors = actionData?.errors;
  const { t } = useT();

  return (
    <div className="space-y-5 max-w-2xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">{t("settings_title")}</h1>
        <p className="mt-1 text-sm text-slate-500">{t("settings_subtitle")}</p>
      </div>

      {/* Profile */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-100">
          <FaUser className="text-slate-500 text-sm" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-slate-900">{t("settings_profile_section")}</h2>
        </div>
        <div className="p-5">
          {/* Avatar row */}
          <div className="flex items-center gap-4 mb-5 pb-5 border-b border-slate-100">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-700 text-lg font-bold">
              {getInitials(user.name)}
            </div>
            <div>
              <p className="font-semibold text-slate-900">{user.name}</p>
              <p className="text-sm text-slate-500">{user.email}</p>
            </div>
          </div>

          <Form method="post" className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-600">{t("settings_name_label")}</label>
                <input name="name" defaultValue={user.name} required className={inputCls} />
                {errors?.name && <p className="text-xs text-red-500">{errors.name[0]}</p>}
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-600">{t("settings_email_label")}</label>
                <input
                  value={user.email}
                  readOnly
                  className="w-full h-10 rounded-lg border border-slate-200 px-3 text-sm bg-slate-50 text-slate-500 cursor-not-allowed"
                />
                <p className="text-xs text-slate-500">{t("settings_email_note")}</p>
              </div>
            </div>
            <div className="flex justify-end pt-1">
              <button
                type="submit"
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 transition-colors"
              >
                {t("save")}
              </button>
            </div>
          </Form>
        </div>
      </div>

      {/* Company info */}
      {client && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-100">
            <FaBuilding className="text-slate-500 text-sm" aria-hidden="true" />
            <h2 className="text-sm font-semibold text-slate-900">{t("settings_company_section")}</h2>
          </div>
          <div className="p-5 space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <InfoRow label={t("settings_company_name")} value={client.company_name} />
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium text-slate-500">{t("settings_package_label")}</span>
                <span className={`self-start text-xs font-semibold px-2.5 py-1 rounded-full ${packageStyles[client.package as keyof typeof packageStyles] ?? packageStyles.basic}`}>
                  {packageLabels[client.package as keyof typeof packageLabels] ?? client.package}
                </span>
              </div>
              {client.website_url && (
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-slate-500">{t("settings_website_label")}</span>
                  <a
                    href={client.website_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-violet-600 hover:underline truncate"
                  >
                    {client.website_url.replace(/^https?:\/\//, "")}
                  </a>
                </div>
              )}
              <InfoRow
                label={t("settings_contract_end")}
                value={client.contract_end ?? t("settings_contract_no_expiry")}
              />
            </div>
            <p className="text-xs text-slate-500 pt-3 border-t border-slate-100">
              {t("settings_company_edit_note")}
            </p>
          </div>
        </div>
      )}

      {/* Help */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-100">
          <FaCircleQuestion className="text-slate-500 text-sm" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-slate-900">{t("settings_help_section")}</h2>
        </div>
        <div className="p-5">
          <a
            href="/tickets/new"
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-colors"
          >
            <FaTicket className="text-violet-500 text-xs" aria-hidden="true" />
            {t("settings_help_ticket")}
          </a>
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <span className="text-sm font-medium text-slate-800">{value}</span>
    </div>
  );
}
