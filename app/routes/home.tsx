import { redirect } from "react-router";
import type { Route } from "./+types/home";
import { getAuthenticatedUser } from "~/lib/auth.server";

export function meta({}: Route.MetaArgs) {
  return [{ title: "DoAction Client Portal" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const user = await getAuthenticatedUser(
    request,
    context.cloudflare.env.DB,
    context.cloudflare.env.SESSION_KV
  );

  if (!user) throw redirect("/login");
  if (user.role === "admin") throw redirect("/admin");
  throw redirect("/dashboard");
}

export default function Home() {
  return null;
}
