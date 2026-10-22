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
  const required = new URL(request.url).searchParams.get("required") === "1";
  return { twoFactor: await loadTwoFactorState(env, user), required, enabled: Boolean(user.totp_enabled_at) };
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
      {loaderData.required && !loaderData.enabled && (
        <div className="rounded-[20px] border border-[#E9D27A] bg-[#FFF6C2] px-5 py-4 text-sm text-[#5A4A00]">
          <p className="font-semibold">ต้องเปิดการยืนยันตัวตนสองขั้นก่อนใช้งาน portal</p>
          <p className="mt-1">
            บัญชีทีมงานทุกบัญชีต้องเปิด 2FA เพราะ portal เข้าถึงข้อมูลและเว็บไซต์ของลูกค้าได้ ใช้เวลาประมาณ 1 นาที
            ด้วยแอป Google Authenticator, Microsoft Authenticator หรือ 1Password
          </p>
        </div>
      )}
      <TwoFactorCard state={loaderData.twoFactor} result={actionData?.twoFactor} />
      {loaderData.required && loaderData.enabled && (
        <a
          href="/admin"
          className="inline-flex h-10 items-center rounded-full bg-ink px-5 text-[13px] font-semibold text-white hover:bg-black"
        >
          เปิด 2FA แล้ว — ไปที่ portal
        </a>
      )}
    </div>
  );
}
