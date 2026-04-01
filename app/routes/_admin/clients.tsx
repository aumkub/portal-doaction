import { Form } from "react-router";
import type { FormEvent } from "react";
import type { Route } from "./+types/clients";
import { requireAdmin } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";
import { formatRelativeTime } from "~/lib/utils";
import type { Client } from "~/types";
import { useT } from "~/lib/i18n";
import type { TranslationKey } from "~/lib/translations";
import { FaCirclePlus, FaEye, FaUserSecret } from "react-icons/fa6";

export function meta() {
  return [{ title: "จัดการลูกค้า — Admin" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  await requireAdmin(request, context.cloudflare.env.DB, context.cloudflare.env.SESSIONPORTAL);
  const db = createDB(context.cloudflare.env.DB);
  const clients = await db.listClients();
  const clientsWithStatus = await Promise.all(
    clients.map(async (client) => {
      const user = await db.getUserById(client.user_id);
      return {
        ...client,
        first_login_at: user?.first_login_at ?? null,
      };
    })
  );
  return { clients: clientsWithStatus };
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
  const { clients } = loaderData as {
    clients: Array<Client & { first_login_at: number | null }>;
  };
  const { t, lang } = useT();

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
          <FaCirclePlus aria-hidden="true" />
          {t("admin_clients_add")}
        </a>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden overflow-x-auto">
        <table className="w-full text-sm min-w-[800px]">
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
              <th className="text-left text-xs font-medium text-slate-500 px-5 py-3">
                {t("admin_col_login_status")}
              </th>
              <th className="px-5 py-3 text-right text-xs font-medium text-slate-500">Actions</th>
            </tr>
          </thead>
          <tbody>
            {clients.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
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
                  <td className="px-5 py-4">
                    {client.first_login_at ? (
                      <div className="space-y-1">
                        <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">
                          {t("admin_login_status_activated")}
                        </span>
                        <p className="text-[11px] text-slate-500">
                          {formatRelativeTime(client.first_login_at, lang)}
                        </p>
                      </div>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700">
                        {t("admin_login_status_pending")}
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-4 text-right">
                    <div className="flex items-center gap-2">
                      <a
                        href={`/admin/clients/${client.id}`}
                        className="inline-flex items-center gap-1 text-center text-xs font-medium text-violet-700 bg-violet-50 hover:bg-violet-100 hover:text-violet-900 border border-violet-200 px-3 py-1 rounded-lg transition-colors"
                      >
                        <FaEye aria-hidden="true" />
                        {t("admin_view_details")}
                      </a>
                      <Form
                        method="post"
                        action={`/admin/clients/${client.id}`}
                        onSubmit={(e: FormEvent<HTMLFormElement>) => {
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
                          className="inline-flex items-center gap-1 text-xs text-amber-600 hover:text-amber-700 font-medium transition-colors border border-amber-200 bg-amber-50 hover:bg-amber-100 px-2.5 py-1 rounded-lg cursor-pointer"
                        >
                          <FaUserSecret aria-hidden="true" />
                          {t("admin_impersonate")}
                        </button>
                      </Form>
                    </div>
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
