import { Outlet, redirect } from "react-router";
import type { Route } from "./+types/layout";
import { requireUser } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";
import Sidebar from "~/components/layout/Sidebar";
import Topbar from "~/components/layout/Topbar";

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const user = await requireUser(request, env.DB, env.SESSIONPORTAL);
  if (user.role === "admin") throw redirect("/admin/clients");

  const db = createDB(env.DB);
  const [client, notifications] = await Promise.all([
    db.getClientByUserId(user.id),
    db.listNotifications(user.id), // all recent (unread first)
  ]);

  return { user, client, notifications };
}

export default function ClientLayout({ loaderData }: Route.ComponentProps) {
  const { user, client, notifications } = loaderData;

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      <Sidebar role="client" companyName={client?.company_name} />
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <Topbar
          user={user}
          companyName={client?.company_name}
          notifications={notifications}
          role="client"
        />
        <main className="flex-1 overflow-y-auto p-4 lg:p-6 animate-fade-in">
          <Outlet context={{ user, client }} />
        </main>
      </div>
    </div>
  );
}
