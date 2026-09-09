import { Outlet } from "react-router";
import type { Route } from "./+types/layout";
import { requireCoAdminOrAdmin } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";
import Sidebar from "~/components/layout/Sidebar";
import Topbar from "~/components/layout/Topbar";

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const user = await requireCoAdminOrAdmin(request, env.DB, env.SESSIONPORTAL);
  const db = createDB(env.DB);
  const notifications = await db.listNotifications(user.id);
  return { user, notifications };
}

export default function AdminLayout({ loaderData }: Route.ComponentProps) {
  const { user, notifications } = loaderData;

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      <Sidebar role={user.role} />
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <Topbar user={user} notifications={notifications} role={user.role} />
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          <div className="max-w-screen-xl">
            <Outlet context={{ user }} />
          </div>
        </main>
      </div>
    </div>
  );
}
