import type { Route } from "./+types/security";
import { requireCoAdminOrAdmin } from "~/lib/auth.server";
import { handleTwoFactorIntent, loadTwoFactorState } from "~/lib/two-factor.server";
import { TwoFactorCard } from "~/components/settings/TwoFactorCard";
import { Form, useNavigation } from "react-router";
import { FaTelegram } from "react-icons/fa6";
import {
  confirmTelegramLink, countTrustedDevices, forgetTrustedDevices, getBotUsername, getTelegramChatId,
  hasPendingTelegramLink, startTelegramLink, unlinkTelegram,
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
  if (intent === "tg_link_start") {
    const err = await startTelegramLink(env, user.id, String(formData.get("chat_id") ?? ""));
    return { telegram: err ? { error: err } : { message: "ส่งรหัส 6 หลักไปที่ Telegram แล้ว" } };
  }
  if (intent === "tg_link_confirm") {
    const err = await confirmTelegramLink(env, user.id, String(formData.get("code") ?? ""));
    return { telegram: err ? { error: err } : { message: "เชื่อม Telegram แล้ว" } };
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

const inputCls = "h-10 w-full rounded-xl border border-line bg-white px-3.5 text-sm text-ink placeholder:text-faint-ink focus:border-ink/40 focus:outline-none focus:ring-2 focus:ring-ink/10";
const btnCls = "inline-flex h-10 shrink-0 items-center justify-center rounded-full bg-ink px-5 text-[13px] font-semibold text-white hover:bg-black disabled:opacity-50";
const ghostCls = "inline-flex h-9 items-center rounded-full border border-line bg-white px-4 text-[12px] font-semibold text-ink hover:bg-paper";

function TelegramCard({ tg, trusted, result }: {
  tg: { linked: string | null; pending: boolean; bot: string | null };
  trusted: number;
  result?: { error?: string; message?: string };
}) {
  const busy = useNavigation().state !== "idle";
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
        <div className="space-y-3 text-sm">
          <ol className="list-decimal space-y-1 pl-5 text-ink-soft">
            <li>เปิดแชตกับบอท{tg.bot ? <> <a className="font-semibold text-ink underline" href={`https://t.me/${tg.bot}`} target="_blank" rel="noreferrer">@{tg.bot}</a></> : "ของ portal"} แล้วกด Start</li>
            <li>หา Chat ID ของคุณ เช่น ส่งข้อความหา <a className="font-semibold text-ink underline" href="https://t.me/userinfobot" target="_blank" rel="noreferrer">@userinfobot</a> (ตัวเลขในบรรทัด Id)</li>
            <li>กรอก Chat ID ด้านล่าง ระบบจะส่งรหัส 6 หลักไปให้ แล้วกรอกรหัสเพื่อยืนยัน</li>
          </ol>
          <Form method="post" className="flex flex-col gap-2 sm:flex-row">
            <input type="hidden" name="intent" value="tg_link_start" />
            <input name="chat_id" inputMode="numeric" placeholder="Chat ID เช่น 123456789" className={inputCls} required />
            <button className={btnCls} disabled={busy}>ส่งรหัส</button>
          </Form>
          {tg.pending && (
            <Form method="post" className="flex flex-col gap-2 sm:flex-row">
              <input type="hidden" name="intent" value="tg_link_confirm" />
              <input name="code" inputMode="numeric" maxLength={6} placeholder="รหัส 6 หลักจาก Telegram" className={inputCls} required />
              <button className={btnCls} disabled={busy}>ยืนยัน</button>
            </Form>
          )}
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
