import { Form, Outlet, redirect } from "react-router";
import type { Route } from "./+types/layout";
import { getImpersonationData, requireUser } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";
import { generateId } from "~/lib/utils";
import Sidebar from "~/components/layout/Sidebar";
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

  if (client?.contract_end) {
    const firstDays = Number((await db.getAppSetting("contract_warning_first_days")) ?? "14");
    const secondDays = Number((await db.getAppSetting("contract_warning_second_days")) ?? "7");
    const thirdDays = Number((await db.getAppSetting("contract_warning_third_days")) ?? "1");

    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const endDate = new Date(`${client.contract_end}T00:00:00`);
    const diffMs = endDate.getTime() - now.getTime();
    const daysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

    const warningConfigs: Array<{ stage: "first" | "second" | "third"; days: number }> = [
      { stage: "first", days: Number.isFinite(firstDays) ? firstDays : 0 },
      { stage: "second", days: Number.isFinite(secondDays) ? secondDays : 0 },
      { stage: "third", days: Number.isFinite(thirdDays) ? thirdDays : 0 },
    ];

    for (const cfg of warningConfigs) {
      if (cfg.days <= 0) continue;
      if (daysRemaining !== cfg.days) continue;
      const alreadySent = await db.hasContractWarningLog(client.id, cfg.stage, client.contract_end);
      if (alreadySent) continue;

      const body =
        cfg.days === 1
          ? "สัญญาของคุณจะหมดอายุในอีก 1 วัน กรุณาติดต่อทีมงานเพื่อดำเนินการต่ออายุ"
          : `สัญญาของคุณจะหมดอายุในอีก ${cfg.days} วัน กรุณาติดต่อทีมงานเพื่อดำเนินการต่ออายุ`;
      await db.createNotification({
        id: generateId(),
        user_id: user.id,
        type: "contract_expiry_warning",
        title: "แจ้งเตือนวันหมดอายุสัญญา",
        body,
        link: "/settings",
        read: 0,
      });
      await db.createContractWarningLog({
        id: generateId(),
        client_id: client.id,
        warning_stage: cfg.stage,
        contract_end: client.contract_end,
      });
    }
  }

  const notifications = await db.listNotifications(user.id);
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
