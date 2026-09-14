import type { Route } from "./+types/notifications-poll";
import { getAuthenticatedUser } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";

/** GET /api/notifications — poll target for the topbar bell */
export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const user = await getAuthenticatedUser(request, env.DB, env.SESSIONPORTAL);
  if (!user) return Response.json({ notifications: [] }, { status: 401 });

  const db = createDB(env.DB);
  const notifications = await db.listNotifications(user.id);
  return Response.json({ notifications });
}
