import { redirect, data } from "react-router";
import type { Route } from "./+types/impersonation-start";
import { requireAdmin, startImpersonation } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const admin = await requireAdmin(request, env.DB, env.SESSIONPORTAL);
  const db = createDB(env.DB);

  const formData = await request.formData();
  const clientId = formData.get("clientId");

  if (typeof clientId !== "string" || !clientId) {
    throw data("Missing clientId", { status: 400 });
  }

  const client = await db.getClientById(clientId);
  if (!client) throw data("Client not found", { status: 404 });

  const cookie = await startImpersonation(
    request,
    env.DB,
    env.SESSIONPORTAL,
    client.user_id,
    admin.id
  );

  return redirect("/dashboard", {
    headers: { "Set-Cookie": cookie.serialize() },
  });
}
