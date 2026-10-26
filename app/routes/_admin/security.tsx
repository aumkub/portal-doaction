import type { Route } from "./+types/security";
import { requireCoAdminOrAdmin } from "~/lib/auth.server";
import { handleTwoFactorIntent, loadTwoFactorState } from "~/lib/two-factor.server";
import { TwoFactorCard } from "~/components/settings/TwoFactorCard";
import { Form, redirect, useNavigation, useRevalidator } from "react-router";
import { useEffect, useState } from "react";
import { FaTelegram } from "react-icons/fa6";
import {
  countTrustedDevices, forgetTrustedDevices, getBotUsername, getTelegramChatId,
  hasPendingTelegramLink, telegramLinkUrl, unlinkTelegram,
} from "~/lib/telegram-2fa.server";

export function meta() {
  return [{ title: "ความปลอดภัยบัญชี — Admin" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const user = await requireCoAdminOrAdmin(request, env.DB, env.SESSIONPORTAL);
  const required = new URL(request.url).searchParams.get("required") === "1";
  const [twoFactor, chatId, pending, trusted, bot] = await Promise.all([
    loadTwoFactorState(env, user),
    getTelegramChatId(env, user.id),
    hasPendingTelegramLink(env, user.id),
    countTrustedDevices(env, user.id),
    getBotUsername(env),
  ]);
  return {
    twoFactor, required, enabled: Boolean(user.two_factor_enabled),
    telegram: { linked: chatId ? `…${chatId.slice(-4)}` : null, pending, bot },
    trusted,
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const user = await requireCoAdminOrAdmin(request, env.DB, env.SESSIONPORTAL);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");
  if (intent === "tg_link") {
    // Opens Telegram on the bot with a one-time code; pressing Start links the chat.
    const url = await telegramLinkUrl(request, env, user.id);
    if (url) return redirect(url);
    return { telegram: { error: "เชื่อม Telegram ไม่ได้ — ตรวจการตั้งค่าบอทในหน้าตั้งค่า" } };
  }
  if (intent === "tg_unlink") {
    await unlinkTelegram(env, user.id);
    return { telegram: { message: "ยกเลิกการเชื่อม Telegram แล้ว" } };
  }
  if (intent === "trust_forget") {
    await forgetTrustedDevices(env, user.id);
    return { telegram: { message: "ลืมอุปกรณ์ที่จำไว้ทั้งหมดแล้ว ทุกเครื่องต้องยืนยันสองขั้นอีกครั้งในการเข้าสู่ระบบครั้งถัดไป" } };
  }
  return (await handleTwoFactorIntent(request, env, user, intent, formData)) ?? {
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
            เลือกได้ว่าจะใช้ passkey (Face ID / Touch ID / Windows Hello) หรือแอป Authenticator เช่น Google Authenticator, 1Password
          </p>
        </div>
      )}
      <TwoFactorCard state={loaderData.twoFactor} result={actionData && "twoFactor" in actionData ? actionData.twoFactor : undefined} />
      <TelegramCard
        tg={loaderData.telegram}
        trusted={loaderData.trusted}
        result={actionData && "telegram" in actionData ? actionData.telegram : undefined}
      />
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

const btnCls = "inline-flex h-10 shrink-0 items-center justify-center rounded-full bg-ink px-5 text-[13px] font-semibold text-white hover:bg-black disabled:opacity-50";
const ghostCls = "inline-flex h-9 items-center rounded-full border border-line bg-white px-4 text-[12px] font-semibold text-ink hover:bg-paper";

function TelegramCard({ tg, trusted, result }: {
  tg: { linked: string | null; pending: boolean; bot: string | null };
  trusted: number;
  result?: { error?: string; message?: string };
}) {
  const busy = useNavigation().state !== "idle";
  const revalidator = useRevalidator();
  const [waiting, setWaiting] = useState(false);
  // While a link is pending, check every 3 s whether Start was pressed in Telegram.
  useEffect(() => {
    if (tg.linked || !(tg.pending || waiting)) return;
    const t = setInterval(() => { if (revalidator.state === "idle") revalidator.revalidate(); }, 3000);
    return () => clearInterval(t);
  }, [tg.linked, tg.pending, waiting, revalidator]);
  return (
    <section className="space-y-4 rounded-[20px] border border-line bg-white p-6">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-paper text-ink"><FaTelegram aria-hidden="true" /></span>
        <div>
          <h2 className="text-[16px] font-semibold text-ink">ยืนยันผ่าน Telegram</h2>
          <p className="mt-0.5 text-sm text-muted-ink">อีกทางเลือกตอนเข้าสู่ระบบ ใช้ได้ทุกเครื่อง: บอทส่งปุ่มมาให้กดยืนยันใน Telegram ของคุณ</p>
        </div>
      </div>

      {tg.linked ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-paper px-4 py-3 text-sm">
          <span className="text-ink">เชื่อมแล้ว · Chat ID {tg.linked}</span>
          <Form method="post"><input type="hidden" name="intent" value="tg_unlink" /><button className={ghostCls} disabled={busy}>ยกเลิกการเชื่อม</button></Form>
        </div>
      ) : (
        <div className="space-y-2 text-sm">
          <Form method="post" target="_blank" onSubmit={() => setWaiting(true)}>
            <input type="hidden" name="intent" value="tg_link" />
            <button className={btnCls} disabled={busy}><FaTelegram className="mr-2" aria-hidden="true" />เชื่อม Telegram</button>
          </Form>
          <p className="text-xs text-muted-ink">
            {tg.pending || waiting ? "เปิด Telegram แล้วกด Start ที่บอท หน้านี้จะอัปเดตเองเมื่อเชื่อมเสร็จ" : `เปิดแชตกับบอท${tg.bot ? ` @${tg.bot}` : ""} แล้วกด Start ครั้งเดียว ก็เชื่อมเสร็จ`}
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-soft pt-4 text-sm">
        <span className="text-ink-soft">อุปกรณ์ที่จำไว้ (ไม่ต้องยืนยันสองขั้น 30 วัน): <b className="text-ink">{trusted}</b> เครื่อง</span>
        {trusted > 0 && (
          <Form method="post"><input type="hidden" name="intent" value="trust_forget" /><button className={ghostCls} disabled={busy}>ลืมทุกเครื่อง</button></Form>
        )}
      </div>
      {result?.error && <p className="text-xs text-[#B4541A]">{result.error}</p>}
      {result?.message && <p className="text-xs text-emerald-700">{result.message}</p>}
    </section>
  );
}
