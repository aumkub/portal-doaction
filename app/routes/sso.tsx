import { redirect } from "react-router";
import type { Route } from "./+types/sso";
import { redeemSsoToken } from "~/lib/sso.server";

export function loader() {
  return redirect("/login");
}

/** Lands the auto-submitted form from the Do Action: Care widget. */
export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const res = await redeemSsoToken(context.cloudflare.env, request, "login", String(form.get("token") ?? ""));
  return res ?? redirect("/login?redirect=%2Ftickets%2Fnew");
}
