import { Form } from "react-router";
import { requireAdmin } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";
import { formatRelativeTime } from "~/lib/utils";
import { useT } from "~/lib/i18n";

export function meta() {
  return [{ title: "Notifications — Admin" }];
}

export async function loader({ request, context }: any) {
  const env = context.cloudflare.env;
  const admin = await requireAdmin(request, env.DB, env.SESSIONPORTAL);
  const db = createDB(env.DB);
  const notifications = await db.listNotificationsAll(admin.id);
  return { notifications };
}

export default function AdminNotificationsPage({ loaderData }: any) {
  const { notifications } = loaderData as { notifications: any[] };
  const { t, lang } = useT();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">{t("topbar_notifications")}</h1>
        <Form method="post" action="/api/notifications/read">
          <button type="submit" className="text-sm text-violet-600 hover:text-violet-700">
            {t("topbar_mark_all_read")}
          </button>
        </Form>
      </div>
      <div className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
        {notifications.length === 0 ? (
          <p className="p-6 text-sm text-slate-500">{t("topbar_no_notifications")}</p>
        ) : (
          notifications.map((n) => (
            <Form key={n.id} method="post" action="/api/notifications/read" className="p-4">
              <input type="hidden" name="id" value={n.id} />
              <button type="submit" className="w-full text-left">
                <p className="text-sm font-medium text-slate-800">{n.title}</p>
                {n.body ? <p className="mt-1 text-xs text-slate-500">{n.body}</p> : null}
                <p className="mt-1 text-[11px] text-slate-500">
                  {formatRelativeTime(n.created_at, lang)}
                </p>
              </button>
            </Form>
          ))
        )}
      </div>
    </div>
  );
}
