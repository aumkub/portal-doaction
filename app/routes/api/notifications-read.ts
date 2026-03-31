import type { Route } from "./+types/notifications-read";
import { redirect } from "react-router";
import { getAuthenticatedUser } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";

/** POST /api/notifications/read — mark one or all notifications as read */
export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const user = await getAuthenticatedUser(request, env.DB, env.SESSIONPORTAL);
  if (!user) return Response.json({ ok: false }, { status: 401 });

  const db = createDB(env.DB);
  const formData = await request.formData();
  const id = formData.get("id") as string | null;
  const referer = request.headers.get("referer") || "/";

  if (id) {
    const notification = await db.getNotificationById(id);
    if (notification && notification.user_id === user.id) {
      await db.markNotificationRead(id);
      return redirect(notification.link || referer);
    }
    return redirect(referer);
  } else {
    await db.markAllNotificationsRead(user.id);
    return redirect(referer);
  }
}
