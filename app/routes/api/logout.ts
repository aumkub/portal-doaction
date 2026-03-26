import { redirect } from "react-router";
import type { Route } from "./+types/logout";
import { createAuth } from "~/lib/auth.server";

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const { lucia } = createAuth(env.DB, env.SESSIONPORTAL);
  const cookieHeader = request.headers.get("Cookie") ?? "";
  const sessionId = lucia.readSessionCookie(cookieHeader);

  if (sessionId) {
    await lucia.invalidateSession(sessionId);
  }

  const blankCookie = lucia.createBlankSessionCookie();
  return redirect("/login", {
    headers: { "Set-Cookie": blankCookie.serialize() },
  });
}
