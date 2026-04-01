import { Outlet, redirect } from "react-router";
import type { Route } from "./+types/layout";
import { getImpersonationData, requireUser } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";
import { generateId } from "~/lib/utils";
import Sidebar from "~/components/layout/Sidebar";
import Topbar from "~/components/layout/Topbar";

function parseCookie(header: string, name: string): string | null {
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const user = await requireUser(request, env.DB, env.SESSIONPORTAL);

  // Allow admins through when they're impersonating
  const isImpersonating = !!parseCookie(
    request.headers.get("Cookie") ?? "",
    "_admin_session"
  );
  if (user.role === "admin" && !isImpersonating) {
    throw redirect("/admin/clients");
  }

  const db = createDB(env.DB);
  const [client, impersonation] = await Promise.all([
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

        {/* Impersonation banner */}
        {isImpersonating && (
          <div className="flex items-center justify-between bg-amber-500 text-white text-xs font-medium px-4 py-2 shrink-0">
            <span>
              👤 กำลังใช้งานแทน <strong>{client?.company_name ?? user.email}</strong>
            </span>
            <Form method="post" action="/api/impersonate-exit">
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
