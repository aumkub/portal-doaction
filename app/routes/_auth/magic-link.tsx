import { redirect } from "react-router";
import type { Route } from "./+types/magic-link";
import { createAuth } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";

/**
 * GET /magic-link?token=xxx
 * Validates the token, creates a KV session, and redirects.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const url = new URL(request.url);
  const token = url.searchParams.get("token");

  if (!token) {
    return redirect("/login");
  }

  const db = createDB(env.DB);
  const record = await db.getMagicLinkToken(token);

  if (!record) {
    // Token invalid, expired, or already used
    return redirect("/login?error=invalid_token");
  }

  // Mark as used immediately to prevent replay
  await db.markMagicLinkUsed(record.id);

  // Create Lucia session stored in KV
  const { lucia } = createAuth(env.DB, env.SESSIONPORTAL);
  const session = await lucia.createSession(record.user_id, {});
  const sessionCookie = lucia.createSessionCookie(session.id);

  // Redirect based on role
  const user = await db.getUserById(record.user_id);
  if (user?.first_login_at == null) {
    await db.updateUser(record.user_id, {
      first_login_at: Math.floor(Date.now() / 1000),
    });
  }
  const destination = user?.role === "admin" ? "/admin/clients" : "/dashboard";

  return redirect(destination, {
    headers: { "Set-Cookie": sessionCookie.serialize() },
  });
}

/** No UI — this route only handles the redirect. */
export default function MagicLinkVerify() {
  return (
    <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-10 text-center">
      <div className="w-16 h-16 bg-violet-50 rounded-full flex items-center justify-center mx-auto mb-4">
        <span className="text-3xl">⏳</span>
      </div>
      <p className="text-slate-600 text-sm">กำลังเข้าสู่ระบบ…</p>
    </div>
  );
}
