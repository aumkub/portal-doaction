import { Form } from "react-router";
import type { Route } from "./+types/clients";
import { requireAdmin } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";
import type { Client } from "~/types";
import { useT } from "~/lib/i18n";
import type { TranslationKey } from "~/lib/translations";

export function meta() {
  return [{ title: "จัดการลูกค้า — Admin" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  await requireAdmin(request, context.cloudflare.env.DB, context.cloudflare.env.SESSIONPORTAL);
  const db = createDB(context.cloudflare.env.DB);
  const clients = await db.listClients();
  return { clients };
}

const packageKeys: Record<Client["package"], TranslationKey> = {
  basic: "admin_pkg_basic",
  standard: "admin_pkg_standard",
  premium: "admin_pkg_premium",
};
const packageColors = {
  basic: "bg-slate-100 text-slate-600",
  standard: "bg-blue-50 text-blue-600",
  premium: "bg-[#F0D800]/20 text-amber-700",
};

export default function AdminClientsPage({ loaderData }: Route.ComponentProps) {
  const { clients } = loaderData as { clients: Client[] };
  const { t } = useT();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">
            {t("admin_clients_title")}
          </h1>
          <p className="text-slate-500 text-sm mt-1">
            {t("admin_clients_subtitle").replace("{count}", String(clients.length))}
          </p>
        </div>
        <a
          href="/admin/clients/new"
          className="flex items-center gap-2 bg-[#F0D800] text-slate-900 rounded-lg px-4 py-2 text-sm font-medium hover:bg-yellow-400 transition-colors"
        >
          {t("admin_clients_add")}
        </a>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="text-left text-xs font-medium text-slate-500 px-5 py-3">
                {t("admin_col_client")}
              </th>
              <th className="text-left text-xs font-medium text-slate-500 px-5 py-3">
                {t("admin_col_website")}
              </th>
              <th className="text-left text-xs font-medium text-slate-500 px-5 py-3">
                {t("admin_col_package")}
              </th>
              <th className="text-left text-xs font-medium text-slate-500 px-5 py-3">
                {t("admin_col_contract")}
              </th>
              <th className="px-5 py-3" />
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody>
            {clients.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-5 py-12 text-center text-slate-400"
                >
                  {t("admin_clients_empty")}
                </td>
              </tr>
            ) : (
              clients.map((client) => (
                <tr
                  key={client.id}
                  className="border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors"
                >
                  <td className="px-5 py-4 font-medium text-slate-900">
                    {client.company_name}
                  </td>
                  <td className="px-5 py-4 text-slate-500">
                    {client.website_url ? (
                      <a
                        href={client.website_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-slate-900 underline underline-offset-2"
                      >
                        {client.website_url.replace(/^https?:\/\//, "")}
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-5 py-4">
                    <span
                      className={`text-xs font-medium px-2 py-1 rounded-full ${packageColors[client.package]}`}
                    >
                      {t(packageKeys[client.package])}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-slate-500">
                    {client.contract_end ?? t("settings_contract_no_expiry")}
                  </td>
                  <td className="px-5 py-4 text-right">
                    <a
                      href={`/admin/clients/${client.id}`}
                      className="text-xs text-slate-500 hover:text-slate-900 transition-colors"
                    >
                      {t("admin_view_details")}
                    </a>
                  </td>
                  <td className="px-5 py-4 text-right">
                    <Form
                      method="post"
                      action={`/admin/clients/${client.id}`}
                      onSubmit={(e) => {
                        if (
                          !confirm(
                            `${t("admin_impersonate_confirm")} ${client.company_name}?`
                          )
                        ) {
                          e.preventDefault();
                        }
                      }}
                    >
                      <input type="hidden" name="intent" value="impersonate" />
                      <button
                        type="submit"
                        className="text-xs text-amber-600 hover:text-amber-700 font-medium transition-colors border border-amber-200 bg-amber-50 hover:bg-amber-100 px-2.5 py-1 rounded-lg"
                      >
                        {t("admin_impersonate")}
                      </button>
                    </Form>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
