import { requireAdmin } from "~/lib/auth.server";
import { getBackupList } from "~/lib/backup.server";

export async function action({ request, context }: any) {
  const env = context.cloudflare.env;
  await requireAdmin(request, env.DB, env.SESSIONPORTAL);

  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const backup = await getBackupList(env, env.SESSIONPORTAL, { forceRefresh: true });
  return Response.json({ backup });
}
