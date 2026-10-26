import type { Route } from "./+types/telegram-webhook";
import { handleTelegramWebhook } from "~/lib/telegram-2fa.server";

export async function action({ request, context }: Route.ActionArgs) {
  return handleTelegramWebhook(request, context.cloudflare.env);
}
