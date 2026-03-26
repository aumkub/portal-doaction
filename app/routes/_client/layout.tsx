import { Form, Outlet, redirect } from "react-router";
import type { Route } from "./+types/layout";
import { getImpersonationData, requireUser } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";
import Sidebar from "~/components/layout/Sidebar";
import Topbar from "~/components/layout/Topbar";

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const user = await requireUser(request, env.DB, env.SESSIONPORTAL);
  if (user.role === "admin") throw redirect("/admin/clients");

  const db = createDB(env.DB);
  const [client, notifications, impersonation] = await Promise.all([
    db.getClientByUserId(user.id),
    db.listNotifications(user.id), // all recent (unread first)
    getImpersonationData(request, env.DB, env.SESSIONPORTAL),
  ]);

  return { user, client, notifications, isImpersonating: Boolean(impersonation) };
}

export default function ClientLayout({ loaderData }: Route.ComponentProps) {
  const { user, client, notifications, isImpersonating } = loaderData;

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
        <main className="flex-1 overflow-y-auto p-4 lg:p-6 animate-fade-in">
          <Outlet context={{ user, client }} />
        </main>
      </div>
    </div>
  );
}
