/**
 * Secrets come only from Worker secrets (`wrangler secret put`), never from
 * source or wrangler config, so a leaked repo does not leak them.
 */

/** HMAC key for signed report links. Fails closed when unset. */
export function getReportLinkSecret(env: CloudflareEnv): string {
  if (!env.SESSION_SECRET) throw new Error("SESSION_SECRET is not configured");
  return env.SESSION_SECRET;
}

/** UptimeRobot API key, or null when uptime monitoring is not configured. */
export function getUptimeRobotKey(env: CloudflareEnv): string | null {
  return env.UPTIMEROBOT_API_KEY || null;
}
