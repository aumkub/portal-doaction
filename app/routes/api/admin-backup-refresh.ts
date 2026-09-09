import { requireAdmin } from "~/lib/auth.server";
import { getBackupList, readWebDAVConfig } from "~/lib/backup.server";
import { createDB } from "~/lib/db.server";

export async function action({ request, context }: any) {
  const env = context.cloudflare.env;
  await requireAdmin(request, env.DB, env.SESSIONPORTAL);

  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const webdavConfig = await readWebDAVConfig(createDB(env.DB));
  const backup = await getBackupList(webdavConfig, env.SESSIONPORTAL, {
    forceRefresh: true,
  });
  return Response.json({ backup });
}
