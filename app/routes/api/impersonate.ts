import { redirect } from "react-router";
import type { Route } from "./+types/impersonate";

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const { requireAdmin, createAuth } = await import("~/lib/auth.server");
  const { createDB } = await import("~/lib/db.server");

  await requireAdmin(request, env.DB, env.SESSIONPORTAL);

  const formData = await request.formData();
  const clientId = String(formData.get("clientId") ?? "");
  if (!clientId) throw new Response("Bad Request", { status: 400 });

  const db = createDB(env.DB);
  const client = await db.getClientById(clientId);
  if (!client) throw new Response("Not Found", { status: 404 });

  const clientUser = await db.getUserById(client.user_id);
  if (!clientUser || clientUser.role === "admin") {
    throw new Response("Forbidden", { status: 403 });
  }

  // Capture admin's current session ID before creating the new one
  const { lucia } = createAuth(env.DB, env.SESSIONPORTAL);
  const adminSessionId = lucia.readSessionCookie(
    request.headers.get("Cookie") ?? ""
  );
  if (!adminSessionId) throw new Response("Unauthorized", { status: 401 });

  // Create a session for the client user
  const clientSession = await lucia.createSession(clientUser.id, {});
  const clientSessionCookie = lucia.createSessionCookie(clientSession.id);

  const isSecure = new URL(request.url).protocol === "https:";
  const returnCookie = [
    `_admin_session=${encodeURIComponent(adminSessionId)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    ...(isSecure ? ["Secure"] : []),
  ].join("; ");

  return redirect("/dashboard", {
    headers: [
      ["Set-Cookie", clientSessionCookie.serialize()],
      ["Set-Cookie", returnCookie],
    ],
  });
}
