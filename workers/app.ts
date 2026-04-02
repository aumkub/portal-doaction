import { createRequestHandler } from "react-router";
import { runTicketReminder } from "~/lib/ticket-reminder.server";

// AppLoadContext is augmented in app/types/cloudflare.d.ts

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

export default {
  fetch(request: Request, env: CloudflareEnv, ctx: ExecutionContext) {
    return requestHandler(request, {
      cloudflare: { env, ctx },
    });
  },
  async scheduled(_controller: ScheduledController, env: CloudflareEnv, ctx: ExecutionContext) {
    ctx.waitUntil(runTicketReminder(env));
  },
} satisfies ExportedHandler<CloudflareEnv>;
