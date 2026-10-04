import { Form, Outlet, redirect } from "react-router";
import type { Route } from "./+types/layout";
import { getImpersonationData, requireUser } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";
import { ClientBottomNav } from "~/components/layout/Sidebar";
import Topbar from "~/components/layout/Topbar";

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const user = await requireUser(request, env.DB, env.SESSIONPORTAL);
  if (user.role === "admin") throw redirect("/admin/clients");

  const db = createDB(env.DB);
  const [client, impersonation] = await Promise.all([
    db.getClientByUserId(user.id),
    getImpersonationData(request, env.DB, env.SESSIONPORTAL),
  ]);

  // Contract-expiry warnings (in-app + email) are sent by the daily cron.
  const notifications = await db.listNotifications(user.id);
  return { user, client, notifications, isImpersonating: Boolean(impersonation) };
}

export default function ClientLayout({ loaderData }: Route.ComponentProps) {
  const { user, client, notifications, isImpersonating } = loaderData;

  return (
    <div className="flex h-screen bg-paper overflow-hidden">
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <Topbar
          user={user}
          companyName={client?.company_name}
          notifications={notifications}
          role="client"
        />
        {isImpersonating ? (
          <div className="bg-amber-50 border-b border-amber-200 px-4 lg:px-6 py-2 flex items-center justify-between gap-3">
            <p className="text-xs text-amber-900">
              You are impersonating a client session.
            </p>
            <Form method="post" action="/api/impersonation/stop">
              <button
                type="submit"
                className="text-xs rounded-md bg-amber-500 px-2.5 py-1 text-white hover:bg-amber-600"
              >
                Return to admin
              </button>
            </Form>
          </div>
        ) : null}
        <main className="flex-1 overflow-y-auto px-4 pt-6 pb-28 md:pb-16 lg:px-8 lg:pt-8 animate-fade-in">
          <div className="mx-auto max-w-[1200px]">
            <Outlet context={{ user, client }} />
          </div>
        </main>
      </div>
      <ClientBottomNav />
    </div>
  );
}
