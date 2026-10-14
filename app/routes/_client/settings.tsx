import { Form, redirect, useSearchParams } from "react-router";
import { z } from "zod";
import { requireUser, evictUserCache } from "~/lib/auth.server";
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
  basic:    "bg-paper text-muted-ink",
  standard: "bg-ink text-white",
  premium:  "bg-brand-yellow text-ink",
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
  await evictUserCache(env.SESSIONPORTAL, user.id);
  return redirect("/settings");
}

const inputCls = "w-full h-10 rounded-xl border border-line bg-white px-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-ink/10 focus:border-ink/40 transition";

export default function ClientSettingsPage({ loaderData, actionData }: any) {
  const { user, client } = loaderData;
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get("tab") ?? "profile";
  const errors = actionData?.errors;
  const { t, lang } = useT();

  const tabs = [
    { id: "profile", label: lang === "th" ? "โปรไฟล์" : "Profile", icon: <FaUser className="text-[10px]" /> },
    { id: "company", label: lang === "th" ? "บริษัท" : "Company", icon: <FaBuilding className="text-[10px]" /> },
    { id: "help", label: lang === "th" ? "ช่วยเหลือ" : "Help", icon: <FaCircleQuestion className="text-[10px]" /> },
  ];

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Header */}
      <div>
        <h1 className="text-[28px] md:text-[32px] font-bold leading-tight tracking-[-0.02em] text-ink">{t("settings_title")}</h1>
        <p className="mt-1 text-sm text-muted-ink">{t("settings_subtitle")}</p>
      </div>

      {/* Tab Navigation */}
      <div className="inline-flex max-w-full overflow-x-auto rounded-full bg-paper p-[3px]">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setSearchParams({ tab: tab.id })}
            className={`flex h-8 items-center gap-2 px-3.5 rounded-full text-[13px] font-medium transition-all ${
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

      {/* Tab Content */}
      {activeTab === "profile" && (
        <div className="bg-white rounded-[20px] border border-line overflow-hidden">
          <div className="flex items-center gap-2 px-5 py-4 border-b border-line-soft">
            <FaUser className="text-muted-ink text-sm" aria-hidden="true" />
            <h2 className="text-[16px] font-semibold text-ink">{t("settings_profile_section")}</h2>
          </div>
          <div className="p-5">
            {/* Avatar row */}
            <div className="flex items-center gap-4 mb-5 pb-5 border-b border-line-soft">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[14px] bg-ink text-brand-yellow text-lg font-semibold">
                {getInitials(user.name)}
              </div>
              <div>
                <p className="font-semibold text-ink">{user.name}</p>
                <p className="text-sm text-muted-ink">{user.email}</p>
              </div>
            </div>

            <Form method="post" className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-ink">{t("settings_name_label")}</label>
                  <input name="name" defaultValue={user.name} required className={inputCls} />
                  {errors?.name && <p className="text-xs text-red-500">{errors.name[0]}</p>}
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-ink">{t("settings_email_label")}</label>
                  <input
                    value={user.email}
                    readOnly
                    className="w-full h-10 rounded-xl border border-line px-3.5 text-sm bg-paper text-muted-ink cursor-not-allowed"
                  />
                  <p className="text-xs text-muted-ink">{t("settings_email_note")}</p>
                </div>
              </div>
              <div className="flex justify-end pt-1">
                <button
                  type="submit"
                  className="h-10 rounded-full bg-ink px-5 text-[13px] font-semibold text-white hover:bg-black transition-colors"
                >
                  {t("save")}
                </button>
              </div>
            </Form>
          </div>
        </div>
      )}

      {activeTab === "company" && client && (
        <div className="bg-white rounded-[20px] border border-line overflow-hidden">
          <div className="flex items-center gap-2 px-5 py-4 border-b border-line-soft">
            <FaBuilding className="text-muted-ink text-sm" aria-hidden="true" />
            <h2 className="text-[16px] font-semibold text-ink">{t("settings_company_section")}</h2>
          </div>
          <div className="p-5 space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <InfoRow label={t("settings_company_name")} value={client.company_name} />
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium text-muted-ink">{t("settings_package_label")}</span>
                <span className={`self-start inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${packageStyles[client.package as keyof typeof packageStyles] ?? packageStyles.basic}`}>
                  {packageLabels[client.package as keyof typeof packageLabels] ?? client.package}
                </span>
              </div>
              {client.website_url && (
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-muted-ink">{t("settings_website_label")}</span>
                  <a
                    href={client.website_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-ink underline-offset-4 hover:underline truncate"
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
            <p className="text-xs text-muted-ink pt-3 border-t border-line-soft">
              {t("settings_company_edit_note")}
            </p>
          </div>
        </div>
      )}

      {activeTab === "help" && (
        <div className="bg-white rounded-[20px] border border-line overflow-hidden">
          <div className="flex items-center gap-2 px-5 py-4 border-b border-line-soft">
            <FaCircleQuestion className="text-muted-ink text-sm" aria-hidden="true" />
            <h2 className="text-[16px] font-semibold text-ink">{t("settings_help_section")}</h2>
          </div>
          <div className="p-5">
            <a
              href="/tickets/new"
              className="inline-flex h-10 items-center gap-2 rounded-full border border-line bg-white px-5 text-[13px] font-semibold text-ink hover:bg-paper transition-colors"
            >
              <FaTicket className="text-faint-ink text-xs" aria-hidden="true" />
              {t("settings_help_ticket")}
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-ink">{label}</span>
      <span className="text-sm font-medium text-ink-soft">{value}</span>
    </div>
  );
}