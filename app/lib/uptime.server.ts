const MONITOR_UP = 2;

export type UptimeResult = {
  uptimeRatio: number | null;
  isUp: boolean | null;
};

export async function fetchUptimeForWebsite(
  websiteUrl: string,
  apiKey: string | null
): Promise<UptimeResult> {
  if (!apiKey) return { uptimeRatio: null, isUp: null };
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

export interface MonitorSummary {
  name: string;
  url: string;
  host: string;
  /** "up" | "down" | "paused" | "pending" from UptimeRobot's numeric status. */
  state: "up" | "down" | "paused" | "pending";
  /** 30-day uptime percentage, or null when UptimeRobot has none yet. */
  uptime30: number | null;
}

const CACHE_KEY = "uptime:monitors:v1";
const CACHE_TTL = 300; // seconds; the free plan allows ~10 requests a minute

export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url.includes("://") ? url : `https://${url}`).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Every monitor with its 30-day uptime in one request, cached in KV for a
 * few minutes so dashboard reloads do not hit UptimeRobot's rate limit.
 * Returns null when no key is set or UptimeRobot cannot be reached.
 */
export async function fetchAllMonitors(
  apiKey: string | null,
  kv?: KVNamespace
): Promise<MonitorSummary[] | null> {
  if (!apiKey) return null;
  if (kv) {
    const cached = await kv.get<MonitorSummary[]>(CACHE_KEY, "json").catch(() => null);
    if (cached) return cached;
  }
  try {
    const resp = await fetch("https://api.uptimerobot.com/v2/getMonitors", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ api_key: apiKey, format: "json", custom_uptime_ratios: "30" }).toString(),
      signal: AbortSignal.timeout(8000),
    });
    const data = (await resp.json()) as {
      stat?: string;
      monitors?: Array<{ friendly_name?: string; url?: string; status?: number; custom_uptime_ratio?: string }>;
    };
    if (data.stat !== "ok" || !data.monitors) return null;
    const monitors: MonitorSummary[] = data.monitors.map((m) => {
      const ratio = m.custom_uptime_ratio ? parseFloat(m.custom_uptime_ratio.split("-")[0]) : NaN;
      // UptimeRobot status: 0 paused, 1 not checked yet, 2 up, 8 seems down, 9 down.
      const state =
        m.status === 2 ? "up" : m.status === 8 || m.status === 9 ? "down" : m.status === 0 ? "paused" : "pending";
      return {
        name: m.friendly_name ?? m.url ?? "",
        url: m.url ?? "",
        host: hostOf(m.url) ?? "",
        state,
        uptime30: Number.isFinite(ratio) ? ratio : null,
      };
    });
    if (kv) await kv.put(CACHE_KEY, JSON.stringify(monitors), { expirationTtl: CACHE_TTL }).catch(() => {});
    return monitors;
  } catch {
    return null;
  }
}
