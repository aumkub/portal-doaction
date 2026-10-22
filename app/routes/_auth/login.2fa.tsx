import { Form, Link, redirect, useActionData, useNavigation } from "react-router";
import { useState } from "react";
import type { Route } from "./+types/login.2fa";
import { getChallenge, verifyChallenge } from "~/lib/two-factor.server";
import { FaShieldHalved } from "react-icons/fa6";

export function meta() {
  return [{ title: "ยืนยันตัวตนสองขั้น — do action portal" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const challenge = await getChallenge(context.cloudflare.env, request);
  if (!challenge) return redirect("/login");
  return null;
}

export async function action({ request, context }: Route.ActionArgs) {
  const formData = await request.formData();
  const useRecovery = formData.get("method") === "recovery";
  const code = String(formData.get("code") ?? "").trim();
  if (!code) return { error: "กรุณากรอกรหัส" };
  return verifyChallenge({ request, env: context.cloudflare.env, code, useRecovery });
}

const inputCls =
  "w-full h-12 rounded-xl border border-line bg-white px-3.5 text-center text-lg tracking-[0.3em] text-ink placeholder:text-faint-ink placeholder:tracking-normal focus:outline-none focus:border-ink/40 focus:ring-2 focus:ring-ink/10 transition";

export default function TwoFactorLoginPage() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [useRecovery, setUseRecovery] = useState(false);
  const submitting = navigation.state === "submitting";
  const error = actionData && "error" in actionData ? actionData.error : null;

  return (
    <div className="w-full max-w-md">
      <div className="bg-white rounded-[24px] border border-line px-6 py-8 md:px-10 md:py-10">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-yellow mb-5">
          <FaShieldHalved className="text-base text-ink" aria-hidden="true" />
        </div>
        <h1 className="text-[28px] font-bold leading-tight tracking-[-0.02em] text-ink">
          ยืนยันตัวตนสองขั้น
        </h1>
        <p className="text-sm text-muted-ink mt-2 mb-6">
          {useRecovery
            ? "กรอก recovery code (รูปแบบ xxxx-xxxx) — แต่ละรหัสใช้ได้ครั้งเดียว"
            : "กรอกรหัส 6 หลักจากแอป Authenticator ของคุณ"}
        </p>

        <Form method="post" className="space-y-4" key={useRecovery ? "recovery" : "totp"}>
          <input type="hidden" name="method" value={useRecovery ? "recovery" : "totp"} />
          {useRecovery ? (
            <input
              name="code"
              type="text"
              required
              autoFocus
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="xxxx-xxxx"
              aria-label="Recovery code"
              className={inputCls}
            />
          ) : (
            <input
              name="code"
              type="text"
              required
              autoFocus
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              placeholder="000000"
              aria-label="รหัส 6 หลัก"
              className={inputCls}
            />
          )}
          {error && <p className="text-xs text-[#B4541A]">{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="w-full h-11 rounded-full bg-ink text-white text-[14px] font-semibold hover:bg-black disabled:opacity-50 transition-colors"
          >
            {submitting ? "กำลังตรวจสอบ…" : "ยืนยัน"}
          </button>
        </Form>

        <div className="mt-5 pt-4 border-t border-line-soft flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setUseRecovery((v) => !v)}
            className="text-xs text-muted-ink hover:text-ink transition-colors"
          >
            {useRecovery ? "ใช้รหัสจากแอป Authenticator" : "ใช้ recovery code แทน"}
          </button>
          <Link to="/login" className="text-xs text-muted-ink hover:text-ink transition-colors">
            กลับไปหน้าเข้าสู่ระบบ
          </Link>
        </div>
      </div>
    </div>
  );
}
