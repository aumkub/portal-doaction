import { requireAdmin } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";

const MONITOR_UP = 2;

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

  try {
    const domain = new URL(client.website_url).hostname.replace(/^www\./, "");
    const apiKey =
      (env as any).UPTIMEROBOT_API_KEY ?? "ur2618139-5281beb51ff9820a629669c2";

    const body = new URLSearchParams({
      api_key: apiKey,
      format: "json",
      custom_uptime_ratios: "30",
    });

    const resp = await fetch("https://api.uptimerobot.com/v2/getMonitors", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!resp.ok) return Response.json({ uptimeRatio: null, isUp: null });

    const data = (await resp.json()) as {
      stat?: string;
      monitors?: Array<{
        url?: string;
        status?: number;
        custom_uptime_ratio?: string;
      }>;
    };

    if (data.stat !== "ok" || !data.monitors) {
      return Response.json({ uptimeRatio: null, isUp: null });
    }

    const monitor = data.monitors.find((m) => {
      if (!m.url) return false;
      try {
        return new URL(m.url).hostname.replace(/^www\./, "") === domain;
      } catch {
        return false;
      }
    });

    if (!monitor) return Response.json({ uptimeRatio: null, isUp: null });

    const ratio = monitor.custom_uptime_ratio
      ? parseFloat(monitor.custom_uptime_ratio.split("-")[0])
      : null;

    return Response.json({
      uptimeRatio: ratio != null && !isNaN(ratio) ? ratio : null,
      isUp: monitor.status === MONITOR_UP,
    });
  } catch {
    return Response.json({ uptimeRatio: null, isUp: null });
  }
}
