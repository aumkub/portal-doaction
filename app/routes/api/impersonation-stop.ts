import { redirect } from "react-router";
import type { Route } from "./+types/impersonation-stop";
import { stopImpersonation } from "~/lib/auth.server";

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const cookie = await stopImpersonation(request, env.DB, env.SESSIONPORTAL);

  if (!cookie) throw redirect("/admin/clients");

  return redirect("/admin/clients", {
    headers: { "Set-Cookie": cookie.serialize() },
  });
}
