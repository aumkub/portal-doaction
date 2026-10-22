import { Form, Link, redirect, useActionData, useFetcher, useLoaderData, useNavigation, useSubmit } from "react-router";
import { useEffect, useState } from "react";
import { startAuthentication } from "@simplewebauthn/browser";
import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import type { Route } from "./+types/login.2fa";
import { getChallenge, loginPasskeyOptions, verifyChallenge } from "~/lib/two-factor.server";
import type { ChallengeMethod } from "~/lib/two-factor.server";
import { FaShieldHalved } from "react-icons/fa6";

export function meta() {
  return [{ title: "ยืนยันตัวตนสองขั้น — do action portal" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const challenge = await getChallenge(context.cloudflare.env, request);
  if (!challenge) return redirect("/login");
  return { method: challenge.data.method ?? "totp" };
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const formData = await request.formData();
  if (formData.get("intent") === "passkey_options") {
    const options = await loginPasskeyOptions(request, env);
    if (!options) return { error: "ไม่สามารถเริ่มยืนยันด้วย passkey ได้" };
    return { passkeyOptions: options };
  }
  const raw = String(formData.get("method") ?? "");
  const kind: ChallengeMethod = raw === "recovery" || raw === "passkey" ? raw : "totp";
  const code = String(formData.get("code") ?? "").trim();
  if (!code) return { error: "กรุณากรอกรหัส" };
  return verifyChallenge({ request, env, code, kind });
}

const inputCls =
  "w-full h-12 rounded-xl border border-line bg-white px-3.5 text-center text-lg tracking-[0.3em] text-ink placeholder:text-faint-ink placeholder:tracking-normal focus:outline-none focus:border-ink/40 focus:ring-2 focus:ring-ink/10 transition";

export default function TwoFactorLoginPage() {
  const { method } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const fetcher = useFetcher<typeof action>();
  const submit = useSubmit();
  const [useRecovery, setUseRecovery] = useState(false);
  const [passkeyError, setPasskeyError] = useState<string | null>(null);
  const submitting = navigation.state === "submitting";
  const passkeyBusy = fetcher.state !== "idle" || submitting;
  const error =
    passkeyError ??
    (fetcher.data && "error" in fetcher.data ? fetcher.data.error : null) ??
    (actionData && "error" in actionData ? actionData.error : null);

  const options = fetcher.data && "passkeyOptions" in fetcher.data ? fetcher.data.passkeyOptions : null;
  useEffect(() => {
    if (!options) return;
    let cancelled = false;
    startAuthentication({ optionsJSON: options as PublicKeyCredentialRequestOptionsJSON })
      .then((res) => {
        if (cancelled) return;
        submit({ method: "passkey", code: JSON.stringify(res) }, { method: "post" });
      })
      .catch(() => {
        if (!cancelled) setPasskeyError("ยกเลิกหรือยืนยันด้วย passkey ไม่สำเร็จ");
      });
    return () => {
      cancelled = true;
    };
  }, [options, submit]);

  const showPasskey = method === "passkey" && !useRecovery;

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
            : showPasskey
              ? "ยืนยันด้วย passkey ของคุณ (Face ID / Touch ID / Windows Hello / กุญแจความปลอดภัย)"
              : "กรอกรหัส 6 หลักจากแอป Authenticator ของคุณ"}
        </p>

        {showPasskey ? (
          <div className="space-y-4">
            {error && <p className="text-xs text-[#B4541A]">{error}</p>}
            <button
              type="button"
              disabled={passkeyBusy}
              onClick={() => {
                setPasskeyError(null);
                fetcher.submit({ intent: "passkey_options" }, { method: "post" });
              }}
              className="w-full h-11 rounded-full bg-ink text-white text-[14px] font-semibold hover:bg-black disabled:opacity-50 transition-colors"
            >
              {passkeyBusy ? "กำลังตรวจสอบ…" : "ยืนยันด้วย passkey"}
            </button>
          </div>
        ) : (
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
        )}

        <div className="mt-5 pt-4 border-t border-line-soft flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setUseRecovery((v) => !v)}
            className="text-xs text-muted-ink hover:text-ink transition-colors"
          >
            {useRecovery
              ? method === "passkey"
                ? "ใช้ passkey"
                : "ใช้รหัสจากแอป Authenticator"
              : "ใช้ recovery code แทน"}
          </button>
          <Link to="/login" className="text-xs text-muted-ink hover:text-ink transition-colors">
            กลับไปหน้าเข้าสู่ระบบ
          </Link>
        </div>
      </div>
    </div>
  );
}
