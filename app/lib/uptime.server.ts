const MONITOR_UP = 2;

export type UptimeResult = {
  uptimeRatio: number | null;
  isUp: boolean | null;
};

export async function fetchUptimeForWebsite(
  websiteUrl: string,
  apiKey: string
): Promise<UptimeResult> {
  try {
    const domain = new URL(websiteUrl).hostname.replace(/^www\./, "");
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
    if (!resp.ok) return { uptimeRatio: null, isUp: null };

    const data = (await resp.json()) as {
      stat?: string;
      monitors?: Array<{
        url?: string;
        status?: number;
        custom_uptime_ratio?: string;
      }>;
    };
    if (data.stat !== "ok" || !data.monitors) {
      return { uptimeRatio: null, isUp: null };
    }

    const monitor = data.monitors.find((m) => {
      if (!m.url) return false;
      try {
        return new URL(m.url).hostname.replace(/^www\./, "") === domain;
      } catch {
        return false;
      }
    });
    if (!monitor) return { uptimeRatio: null, isUp: null };

    const ratio = monitor.custom_uptime_ratio
      ? parseFloat(monitor.custom_uptime_ratio.split("-")[0])
      : null;

    return {
      uptimeRatio: ratio != null && !isNaN(ratio) ? ratio : null,
      isUp: monitor.status === MONITOR_UP,
    };
  } catch {
    return { uptimeRatio: null, isUp: null };
  }
}
