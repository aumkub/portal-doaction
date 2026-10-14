import { createRequestHandler } from "react-router";
import { runTicketReminder } from "~/lib/ticket-reminder.server";
import { handleMcpRequest } from "~/lib/mcp/server.server";
import { flushHeldTicketEmails, runDailyEmailAlerts } from "~/lib/email-alerts.server";

// AppLoadContext is augmented in app/types/cloudflare.d.ts

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

export default {
  fetch(request: Request, env: CloudflareEnv, ctx: ExecutionContext) {
    if (new URL(request.url).pathname === "/mcp") {
      return handleMcpRequest(request, env);
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
  },
} satisfies ExportedHandler<CloudflareEnv>;
