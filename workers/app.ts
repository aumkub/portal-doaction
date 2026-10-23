import { createRequestHandler } from "react-router";
import { runTicketReminder } from "~/lib/ticket-reminder.server";
import { handleMcpRequest } from "~/lib/mcp/server.server";
import { handleAgentRequest, isAgentPath } from "~/lib/agent/server";
import { createDB } from "~/lib/db.server";
import { JOB_STALE_AFTER_S } from "~/lib/agent/jobs.server";
import { flushHeldTicketEmails, runDailyEmailAlerts } from "~/lib/email-alerts.server";

// AppLoadContext is augmented in app/types/cloudflare.d.ts

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

const SECURITY_HEADERS: Record<string, string> = {
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": "frame-ancestors 'none'",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

function withSecurityHeaders(res: Response): Response {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    if (!out.headers.has(k)) out.headers.set(k, v);
  }
  return out;
}

export default {
  async fetch(request: Request, env: CloudflareEnv, ctx: ExecutionContext) {
    const url = new URL(request.url);
    // Plain http on the real domain goes to https (local dev stays on http).
    if (url.protocol === "http:" && !import.meta.env.DEV) {
      url.protocol = "https:";
      return Response.redirect(url.toString(), 301);
    }
    const { pathname } = url;
    if (pathname === "/mcp") {
      return withSecurityHeaders(await handleMcpRequest(request, env));
    }
    if (isAgentPath(pathname)) {
      return withSecurityHeaders(await handleAgentRequest(request, env));
    }
    return withSecurityHeaders(await requestHandler(request, {
      cloudflare: { env, ctx },
    }));
  },
  async scheduled(_controller: ScheduledController, env: CloudflareEnv, ctx: ExecutionContext) {
    // Runs every 15 minutes; each job decides for itself whether it is due.
    ctx.waitUntil(runTicketReminder(env));
    ctx.waitUntil(runDailyEmailAlerts(env));
    ctx.waitUntil(flushHeldTicketEmails(env));
    const now = Math.floor(Date.now() / 1000);
    ctx.waitUntil(createDB(env.DB).failStaleSiteJobs(now - JOB_STALE_AFTER_S));
    ctx.waitUntil(createDB(env.DB).expireUnclaimedSiteJobs(now - 86400));
    ctx.waitUntil(env.DB.batch([
      env.DB.prepare("DELETE FROM sso_tokens WHERE expires_at < ?").bind(now),
      env.DB.prepare("DELETE FROM agent_nonces WHERE expires_at < ?").bind(now),
    ]));
  },
} satisfies ExportedHandler<CloudflareEnv>;
