import { redirect } from "react-router";
import type { Route } from "./+types/impersonate-exit";

function parseCookie(header: string, name: string): string | null {
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const { createAuth } = await import("~/lib/auth.server");

  const cookieHeader = request.headers.get("Cookie") ?? "";
  const adminSessionId = parseCookie(cookieHeader, "_admin_session");
  if (!adminSessionId) return redirect("/login");

  const { lucia } = createAuth(env.DB, env.SESSIONPORTAL);

  // Invalidate the impersonation session
  const clientSessionId = lucia.readSessionCookie(cookieHeader);
  if (clientSessionId) {
    await lucia.invalidateSession(clientSessionId);
  }

  // Restore admin session cookie
  const adminCookie = lucia.createSessionCookie(adminSessionId);

  const isSecure = new URL(request.url).protocol === "https:";
  const clearReturnCookie = [
    "_admin_session=",
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    ...(isSecure ? ["Secure"] : []),
  ].join("; ");

  return redirect("/admin/clients", {
    headers: [
      ["Set-Cookie", adminCookie.serialize()],
      ["Set-Cookie", clearReturnCookie],
    ],
  });
}
