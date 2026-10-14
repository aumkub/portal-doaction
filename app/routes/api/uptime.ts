import { requireAdmin } from "~/lib/auth.server";
import { getUptimeRobotKey } from "~/lib/secrets.server";
import { createDB } from "~/lib/db.server";
import { fetchUptimeForWebsite } from "~/lib/uptime.server";

export async function loader({ request, context }: any) {
  const env = context.cloudflare.env;
  await requireAdmin(request, env.DB, env.SESSIONPORTAL);

  const url = new URL(request.url);
  const clientId = url.searchParams.get("clientId");
  if (!clientId) {
    return Response.json({ error: "clientId required" }, { status: 400 });
  }

  const db = createDB(env.DB);
  const client = await db.getClientById(clientId);
  if (!client?.website_url) {
    return Response.json({ uptimeRatio: null, isUp: null });
  }

  const apiKey =
    getUptimeRobotKey(env);
  const uptime = await fetchUptimeForWebsite(client.website_url, apiKey);
  return Response.json(uptime);
}
