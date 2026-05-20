import { Outlet, redirect, Form } from "react-router";
import type { Route } from "./+types/layout";
import { requireUser, getImpersonationData } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";
import Sidebar from "~/components/layout/Sidebar";
import Topbar from "~/components/layout/Topbar";

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const user = await requireUser(request, env.DB, env.SESSIONPORTAL);

  const impersonation = await getImpersonationData(
    request,
    env.DB,
    env.SESSIONPORTAL
  );
  const isImpersonating = !!impersonation;

  // Allow admins through only when they are impersonating a client
  if (user.role === "admin" && !isImpersonating) {
    throw redirect("/admin/clients");
  }

  // Redirect co-admins to admin interface - they should never access customer routes
  if (user.role === "co-admin") {
    throw redirect("/admin");
  }

  const db = createDB(env.DB);
  const [client, notifications] = await Promise.all([
    db.getClientByUserId(user.id),
    db.listNotifications(user.id),
  ]);

  return { user, client, notifications, isImpersonating };
}

export default function ClientLayout({ loaderData }: Route.ComponentProps) {
  const { user, client, notifications, isImpersonating } = loaderData as {
    user: import("~/types").User;
    client: import("~/types").Client | null;
    notifications: import("~/types").Notification[];
    isImpersonating: boolean;
  };

  return (
    <div className="flex h-screen bg-surface overflow-hidden">
      <Sidebar role="client" companyName={client?.company_name} />
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">

        {isImpersonating && (
          <div className="flex items-center justify-between bg-brand-yellow text-primary text-xs font-medium px-4 py-2 shrink-0">
            <span>
              👤 กำลังใช้งานแทน <strong>{client?.company_name ?? user.email}</strong>
            </span>
            <Form method="post" action="/api/impersonation/stop">
              <button
                type="submit"
                className="rounded-md bg-white/20 hover:bg-white/30 px-3 py-1 transition-colors"
              >
                ออกจากโหมดนี้ →
              </button>
            </Form>
          </div>
        )}

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
