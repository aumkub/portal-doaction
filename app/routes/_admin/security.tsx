import type { Route } from "./+types/security";
import { requireCoAdminOrAdmin } from "~/lib/auth.server";
import { handleTwoFactorIntent, loadTwoFactorState } from "~/lib/two-factor.server";
import { TwoFactorCard } from "~/components/settings/TwoFactorCard";

export function meta() {
  return [{ title: "ความปลอดภัยบัญชี — Admin" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const user = await requireCoAdminOrAdmin(request, env.DB, env.SESSIONPORTAL);
  return { twoFactor: await loadTwoFactorState(env, user) };
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const user = await requireCoAdminOrAdmin(request, env.DB, env.SESSIONPORTAL);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");
  return (await handleTwoFactorIntent(env, user, intent, formData)) ?? {
    twoFactor: { error: "คำขอไม่ถูกต้อง" },
  };
}

export default function SecurityPage({ loaderData, actionData }: Route.ComponentProps) {
  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-[28px] md:text-[32px] font-bold tracking-[-0.02em] text-ink">ความปลอดภัยบัญชี</h1>
        <p className="text-muted-ink text-sm mt-0.5">จัดการการยืนยันตัวตนสองขั้นของบัญชีคุณ</p>
      </div>
      <TwoFactorCard state={loaderData.twoFactor} result={actionData?.twoFactor} />
    </div>
  );
}
