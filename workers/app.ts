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

export default {
  fetch(request: Request, env: CloudflareEnv, ctx: ExecutionContext) {
    const { pathname } = new URL(request.url);
    if (pathname === "/mcp") {
      return handleMcpRequest(request, env);
    }
    if (isAgentPath(pathname)) {
      return handleAgentRequest(request, env);
    }
    return requestHandler(request, {
      cloudflare: { env, ctx },
    });
  },
  async scheduled(_controller: ScheduledController, env: CloudflareEnv, ctx: ExecutionContext) {
    // Runs every 15 minutes; each job decides for itself whether it is due.
    ctx.waitUntil(runTicketReminder(env));
    ctx.waitUntil(runDailyEmailAlerts(env));
    ctx.waitUntil(flushHeldTicketEmails(env));
    const now = Math.floor(Date.now() / 1000);
    ctx.waitUntil(createDB(env.DB).failStaleSiteJobs(now - JOB_STALE_AFTER_S));
    ctx.waitUntil(createDB(env.DB).expireUnclaimedSiteJobs(now - 86400));
  },
} satisfies ExportedHandler<CloudflareEnv>;
