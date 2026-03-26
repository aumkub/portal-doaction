import type { Route } from "./+types/notifications-read";
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

  if (id) {
    await db.markNotificationRead(id);
  } else {
    await db.markAllNotificationsRead(user.id);
  }

  return Response.json({ ok: true });
}
