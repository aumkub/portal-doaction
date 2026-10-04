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
  const [notifications, unresolvedTickets] = await Promise.all([
    db.listNotifications(user.id),
    db.countUnresolvedTickets(user.role === "co-admin" ? user.id : null),
  ]);
  return { user, notifications, unresolvedTickets };
}

export default function AdminLayout({ loaderData }: Route.ComponentProps) {
  const { user, notifications, unresolvedTickets } = loaderData;
  const navBadges = { "/admin/tickets": unresolvedTickets };

  return (
    <div className="flex h-screen bg-paper overflow-hidden">
      <Sidebar role={user.role} navBadges={navBadges} />
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <Topbar
          user={user}
          notifications={notifications}
          role={user.role}
          navBadges={navBadges}
        />
        <main className="flex-1 overflow-y-auto px-4 py-6 lg:px-8 lg:py-8">
          <div className="mx-auto max-w-screen-xl">
            <Outlet context={{ user }} />
          </div>
        </main>
      </div>
    </div>
  );
}
