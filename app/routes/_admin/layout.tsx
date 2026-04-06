import { Outlet, useNavigation, redirect } from "react-router";
import type { Route } from "./+types/layout";
import { requireCoAdminOrAdmin } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";
import Sidebar from "~/components/layout/Sidebar";
import Topbar from "~/components/layout/Topbar";

// Restricted pages for co-admins - these pages are only for super admins
const CO_ADMIN_RESTRICTED_PAGES = [
  "/admin/attachments",
  "/admin/email-logs",
  "/admin/settings",
  "/admin/co-admins",
];

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const user = await requireCoAdminOrAdmin(request, env.DB, env.SESSIONPORTAL);
  const db = createDB(env.DB);
  const notifications = await db.listNotifications(user.id);

  // Redirect co-admins from restricted pages
  const pathname = new URL(request.url).pathname;
  if (user.role === "co-admin" && CO_ADMIN_RESTRICTED_PAGES.some(path => pathname === path || pathname.startsWith(path))) {
    throw redirect("/admin");
  }

  return { user, notifications };
}

export default function AdminLayout({ loaderData }: Route.ComponentProps) {
  const { user, notifications } = loaderData;
  const navigation = useNavigation();
  const isLoading = navigation.state !== "idle";
  const role = user.role === "co-admin" ? "co-admin" : "admin";

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      <Sidebar role={role} />
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {isLoading && (
          <div className="fixed top-0 left-0 right-0 z-50 h-0.5 bg-violet-100">
            <div className="h-full bg-violet-500 animate-[loading_1s_ease-in-out_infinite]" style={{ width: "60%" }} />
          </div>
        )}
        <Topbar user={user} notifications={notifications} role={role} />
        <main
          className={`flex-1 overflow-y-auto p-4 lg:p-6 transition-opacity duration-150 ${
            isLoading ? "opacity-60" : "opacity-100 animate-fade-in"
          }`}
        >
          <Outlet context={{ user }} />
        </main>
      </div>
    </div>
  );
}
