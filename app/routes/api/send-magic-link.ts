import { z } from "zod";
import type { Route } from "./+types/send-magic-link";
import { createDB } from "~/lib/db.server";
import { generateMagicToken } from "~/lib/auth.server";
import { sendMagicLinkEmail } from "~/lib/email.server";
import { parseClientCcEmails } from "~/lib/client-cc";

const Schema = z.object({
  email: z.string().email(),
});

export async function action({ request, context }: Route.ActionArgs) {
  const env = (context as any).cloudflare.env;
  const isDebugMode = String(env.MAGIC_LINK_DEBUG ?? "").trim() === "1";

  const contentType = request.headers.get("content-type") ?? "";
  let raw: Record<string, unknown>;

  if (contentType.includes("application/json")) {
    raw = await request.json();
  } else {
    raw = Object.fromEntries(await request.formData());
  }

  const parsed = Schema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ success: false, error: "Invalid email" }, { status: 400 });
  }

  const { email } = parsed.data;
  const db = createDB(env.DB);
  const user = await db.getUserByEmail(email);

  if (user) {
    const recentlySent = await db.hasRecentMagicLinkSent(email, 60);
    if (recentlySent) {
      // Keep response generic for security, but skip re-sending too frequently.
      return Response.json({ success: true });
    }

    const { id, token, expires_at } = generateMagicToken();
    await db.createMagicLinkToken({ id, user_id: user.id, token, expires_at, used: 0 });

    const origin = env.APP_URL || new URL(request.url).origin;
    const magicUrl = `${origin}/magic-link?token=${token}`;
    const client = await db.getClientByUserId(user.id);
    const ccRecipients = parseClientCcEmails(client?.cc_emails).map((ccEmail) => ({ email: ccEmail }));

    if (isDebugMode) {
      console.info("[send-magic-link][debug] skip sending magic link email", {
        email,
        hasCc: ccRecipients.length > 0,
        ccCount: ccRecipients.length,
        ccEmails: ccRecipients.map((r) => r.email),
        magicUrl,
      });
      return Response.json({
        success: false,
        debug: {
          hasCc: ccRecipients.length > 0,
          ccCount: ccRecipients.length,
          ccEmails: ccRecipients.map((r) => r.email),
          sendSkipped: true,
        },
      });
    }

    if (env.SEND_EMAIL) {
      try {
        await sendMagicLinkEmail({
          to: email,
          toName: user.name,
          cc: ccRecipients.length > 0 ? ccRecipients : undefined,
          magicUrl,
          sendEmail: env.SEND_EMAIL,
          db,
          source: "api_send_magic_link",
          lang: user.language === "en" ? "en" : "th",
        });
      } catch (err) {
        // Log but don't leak SMTP errors to the client
        console.error("[send-magic-link] email failed:", err);
      }
    } else {
      console.warn("[send-magic-link] SEND_EMAIL binding not configured - magic link created but not sent");
    }
  }

  // Always return success — never reveal whether email exists
  return Response.json({ success: true });
}
