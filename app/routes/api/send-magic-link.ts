import { z } from "zod";
import type { Route } from "./+types/send-magic-link";
import { createDB } from "~/lib/db.server";
import { generateMagicToken } from "~/lib/auth.server";
import { sendMagicLinkEmail } from "~/lib/email.server";

const Schema = z.object({
  email: z.string().email(),
});

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;

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
    const { id, token, expires_at } = generateMagicToken();
    await db.createMagicLinkToken({ id, user_id: user.id, token, expires_at, used: 0 });

    const origin = env.APP_URL || new URL(request.url).origin;
    const magicUrl = `${origin}/magic-link?token=${token}`;

    try {
      await sendMagicLinkEmail({
        to: email,
        toName: user.name,
        magicUrl,
        apiKey: env.SMTP2GO_API_KEY,
      });
    } catch (err) {
      // Log but don't leak SMTP errors to the client
      console.error("[send-magic-link] email failed:", err);
    }
  }

  // Always return success — never reveal whether email exists
  return Response.json({ success: true });
}
