import { Form, redirect } from "react-router";
import { requireUser } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";
import { formatRelativeTime } from "~/lib/utils";
import { useT } from "~/lib/i18n";

export function meta() {
  return [{ title: "Notifications" }];
}

export async function loader({ request, context }: any) {
  const env = context.cloudflare.env;
  const user = await requireUser(request, env.DB, env.SESSIONPORTAL);
  if (user.role === "admin") throw redirect("/admin/notifications");
  const db = createDB(env.DB);
  const notifications = await db.listNotificationsAll(user.id);
  return { notifications };
}

export default function ClientNotificationsPage({ loaderData }: any) {
  const { notifications } = loaderData as { notifications: any[] };
  const { t, lang } = useT();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-[28px] md:text-[32px] font-bold leading-tight tracking-[-0.02em] text-ink">{t("topbar_notifications")}</h1>
        <Form method="post" action="/api/notifications/read">
          <button type="submit" className="h-10 rounded-full border border-line bg-white px-4 text-[13px] font-semibold text-ink hover:bg-paper">
            {t("topbar_mark_all_read")}
          </button>
        </Form>
      </div>
      <div className="rounded-[20px] border border-line bg-white divide-y divide-line-soft overflow-hidden">
        {notifications.length === 0 ? (
          <p className="p-6 text-sm text-muted-ink">{t("topbar_no_notifications")}</p>
        ) : (
          notifications.map((n) => (
            <Form key={n.id} method="post" action="/api/notifications/read" className="px-5 py-3.5 hover:bg-paper transition-colors">
              <input type="hidden" name="id" value={n.id} />
              <button type="submit" className="w-full text-left">
                <p className="text-sm font-medium text-ink">{n.title}</p>
                {n.body ? <p className="mt-1 text-xs text-muted-ink">{n.body}</p> : null}
                <p className="mt-1 text-[11px] text-muted-ink">
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
