import { Outlet } from "react-router";
import type { Route } from "./+types/layout";
import { requireAdmin } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";
import Sidebar from "~/components/layout/Sidebar";
import Topbar from "~/components/layout/Topbar";

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const user = await requireAdmin(request, env.DB, env.SESSION_KV);
  const db = createDB(env.DB);
  const notifications = await db.listNotifications(user.id, true);
  return { user, notifCount: notifications.length };
}

export default function AdminLayout({ loaderData }: Route.ComponentProps) {
  const { user, notifCount } = loaderData;

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      <Sidebar role="admin" />
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <Topbar user={user} notifCount={notifCount} role="admin" />
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          <Outlet context={{ user }} />
        </main>
      </div>
    </div>
  );
}
