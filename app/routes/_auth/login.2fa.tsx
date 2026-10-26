import { Form, Link, redirect, useActionData, useFetcher, useLoaderData, useNavigation, useSubmit } from "react-router";
import { useEffect, useRef, useState } from "react";
import { startAuthentication } from "@simplewebauthn/browser";
import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import type { Route } from "./+types/login.2fa";
import { finishTelegramChallenge, getChallenge, loginPasskeyOptions, verifyChallenge } from "~/lib/two-factor.server";
import { getTelegramChatId, sendLoginApproval } from "~/lib/telegram-2fa.server";
import type { ChallengeMethod } from "~/lib/two-factor.server";
import { FaShieldHalved, FaTelegram } from "react-icons/fa6";

export function meta() {
  return [{ title: "ยืนยันตัวตนสองขั้น — do action portal" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const challenge = await getChallenge(context.cloudflare.env, request);
  if (!challenge) return redirect("/login");
  const telegram = Boolean(await getTelegramChatId(context.cloudflare.env, challenge.data.userId));
  return { method: challenge.data.method ?? "totp", telegram };
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const formData = await request.formData();
  const remember = formData.get("remember") === "1";
  if (formData.get("intent") === "telegram_send") {
    const challenge = await getChallenge(env, request);
    if (!challenge) return redirect("/login?error=2fa_expired");
    const err = await sendLoginApproval({ request, env, challengeToken: challenge.token, userId: challenge.data.userId });
    return err ? { error: err } : { telegramSent: true };
  }
  if (formData.get("intent") === "telegram_poll") {
    return finishTelegramChallenge(request, env, remember);
  }
  if (formData.get("intent") === "passkey_options") {
    const options = await loginPasskeyOptions(request, env);
    if (!options) return { error: "ไม่สามารถเริ่มยืนยันด้วย passkey ได้" };
    return { passkeyOptions: options };
  }
  const raw = String(formData.get("method") ?? "");
  const kind: ChallengeMethod = raw === "recovery" || raw === "passkey" ? raw : "totp";
  const code = String(formData.get("code") ?? "").trim();
  if (!code) return { error: "กรุณากรอกรหัส" };
  return verifyChallenge({ request, env, code, kind, remember });
}

const inputCls =
  "w-full h-12 rounded-xl border border-line bg-white px-3.5 text-center text-lg tracking-[0.3em] text-ink placeholder:text-faint-ink placeholder:tracking-normal focus:outline-none focus:border-ink/40 focus:ring-2 focus:ring-ink/10 transition";

export default function TwoFactorLoginPage() {
  const { method, telegram } = useLoaderData<typeof loader>();
  const tgSend = useFetcher<typeof action>();
  const tgPoll = useFetcher<typeof action>();
  const [remember, setRemember] = useState(true);
  const tgSent = Boolean(tgSend.data && "telegramSent" in tgSend.data);
  const tgError = tgSend.data && "error" in tgSend.data ? tgSend.data.error : null;
  // Linked to Telegram: send the approve request right away, no extra click.
  const autoSent = useRef(false);
  useEffect(() => {
    if (!telegram || autoSent.current) return;
    autoSent.current = true;
    tgSend.submit({ intent: "telegram_send" }, { method: "post" });
  }, [telegram, tgSend]);
  // After the approve button was sent, ask every 2 s whether it was pressed (5 minutes at most).
  useEffect(() => {
    if (!tgSent) return;
    const started = Date.now();
    const t = setInterval(() => {
      if (Date.now() - started > 5 * 60_000) return clearInterval(t);
      if (tgPoll.state === "idle") tgPoll.submit({ intent: "telegram_poll", remember: remember ? "1" : "" }, { method: "post" });
    }, 2000);
    return () => clearInterval(t);
  }, [tgSent, tgPoll, remember]);
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const fetcher = useFetcher<typeof action>();
  const submit = useSubmit();
  const [useRecovery, setUseRecovery] = useState(false);
  const [passkeyError, setPasskeyError] = useState<string | null>(null);
  const rememberRef = useRef(true);
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
        submit({ method: "passkey", code: JSON.stringify(res), remember: rememberRef.current ? "1" : "" }, { method: "post" });
      })
      .catch(() => {
        if (!cancelled) setPasskeyError("ยกเลิกหรือยืนยันด้วย passkey ไม่สำเร็จ");
      });
    return () => {
      cancelled = true;
    };
  }, [options, submit]);

  const showPasskey = method === "passkey" && !useRecovery;
  const rememberField = <input type="hidden" name="remember" value={remember ? "1" : ""} />;

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
          {rememberField}
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

        {telegram && (
          <div className="mt-5 border-t border-line-soft pt-5">
            {tgSent ? (
              <div className="rounded-2xl bg-paper px-4 py-3 text-sm text-ink">
                <p className="flex items-center gap-2 font-semibold">
                  <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-ink/20 border-t-ink" aria-hidden="true" />
                  รอยืนยันใน Telegram…
                </p>
                <p className="mt-1 text-xs text-muted-ink">ส่งคำขอไปที่ Telegram แล้ว กด "อนุมัติ" ในแชตบอท หน้านี้จะเข้าสู่ระบบให้เอง</p>
                <button type="button" onClick={() => tgSend.submit({ intent: "telegram_send" }, { method: "post" })} className="mt-2 text-xs font-semibold text-muted-ink hover:text-ink">
                  ส่งอีกครั้ง
                </button>
              </div>
            ) : (
              <button
                type="button"
                disabled={tgSend.state !== "idle"}
                onClick={() => tgSend.submit({ intent: "telegram_send" }, { method: "post" })}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-full border border-line bg-white text-[14px] font-semibold text-ink transition-colors hover:bg-paper disabled:opacity-50"
              >
                <FaTelegram aria-hidden="true" />
                {tgSend.state !== "idle" ? "กำลังส่ง…" : "ยืนยันผ่าน Telegram"}
              </button>
            )}
            {tgError && <p className="mt-2 text-xs text-[#B4541A]">{tgError}</p>}
          </div>
        )}

        <label className="mt-5 flex cursor-pointer items-center gap-2 text-xs text-ink-soft">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => { setRemember(e.target.checked); rememberRef.current = e.target.checked; }}
            className="h-4 w-4 accent-ink"
          />
          จำอุปกรณ์นี้ 30 วัน ไม่ต้องยืนยันสองขั้นอีก
        </label>

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
