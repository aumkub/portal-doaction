import { useState } from "react";
import { requireAdmin } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";
import { formatDate } from "~/lib/utils";
import { useT } from "~/lib/i18n";
import type { EmailLog } from "~/types";

export function meta() {
  return [{ title: "Email Logs — Admin" }];
}

export async function loader({ request, context }: any) {
  const env = context.cloudflare.env;
  await requireAdmin(request, env.DB, env.SESSIONPORTAL);
  const db = createDB(env.DB);
  const logs = await db.listEmailLogs(300);
  return { logs };
}

export default function AdminEmailLogsPage({ loaderData }: any) {
  const { logs } = loaderData as { logs: EmailLog[] };
  const { lang, t } = useT();
  const [selected, setSelected] = useState<EmailLog | null>(null);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-slate-900">{t("admin_email_logs_title")}</h1>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[960px] text-sm">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="px-4 py-3 text-left text-xs text-slate-500">{t("admin_email_logs_col_when")}</th>
              <th className="px-4 py-3 text-left text-xs text-slate-500">{t("admin_email_logs_col_to")}</th>
              <th className="px-4 py-3 text-left text-xs text-slate-500">{t("admin_email_logs_col_subject")}</th>
              <th className="px-4 py-3 text-left text-xs text-slate-500">{t("admin_email_logs_col_source")}</th>
              <th className="px-4 py-3 text-left text-xs text-slate-500">{t("admin_email_logs_col_status")}</th>
              <th className="px-4 py-3 text-right text-xs text-slate-500">{t("admin_email_logs_col_action")}</th>
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                  {t("admin_email_logs_empty")}
                </td>
              </tr>
            ) : (
              logs.map((l) => (
                <tr key={l.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-3 text-slate-500">{formatDate(l.created_at, lang)}</td>
                  <td className="px-4 py-3 text-slate-700">{l.to_email}</td>
                  <td className="px-4 py-3 text-slate-800">{l.subject}</td>
                  <td className="px-4 py-3 text-slate-500">{l.source ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        l.status === "sent"
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-rose-50 text-rose-700"
                      }`}
                    >
                      {l.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => setSelected(l)}
                      className="rounded border border-slate-200 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50"
                    >
                      {t("admin_email_logs_preview")}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {selected ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-4xl rounded-xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <h2 className="text-sm font-semibold text-slate-900">{t("admin_email_logs_preview_title")}</h2>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="text-sm text-slate-500 hover:text-slate-700"
              >
                {t("admin_report_email_close")}
              </button>
            </div>
            <div className="max-h-[75vh] overflow-auto p-4">
              <div className="mb-3 text-xs text-slate-500">
                <p>
                  <strong>{t("admin_report_email_to")}:</strong> {selected.to_name ? `${selected.to_name} <${selected.to_email}>` : selected.to_email}
                </p>
                <p>
                  <strong>{t("admin_report_email_subject")}:</strong> {selected.subject}
                </p>
                {selected.error_message ? (
                  <p className="text-rose-600">
                    <strong>{t("admin_email_logs_error")}:</strong> {selected.error_message}
                  </p>
                ) : null}
              </div>
              <iframe
                title={`email-preview-${selected.id}`}
                className="h-[60vh] w-full rounded border border-slate-200"
                srcDoc={selected.html_body}
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
