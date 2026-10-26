import { Form, useActionData, useLoaderData } from "react-router";
import type { Route } from "./+types/login.2fa.approve";
import { approveLogin, getApprovalRequest, wasApproved } from "~/lib/telegram-2fa.server";
import { finishTelegramChallenge, readChallengeToken } from "~/lib/two-factor.server";
import { FaTelegram } from "react-icons/fa6";

export function meta() {
  return [{ title: "ยืนยันการเข้าสู่ระบบ — do action portal" }];
}

/**
 * Opened from the Telegram button. GET only shows the request; approving is a
 * POST, so link previews or prefetching can never approve a login.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const nonce = new URL(request.url).searchParams.get("n") ?? "";
  const env = context.cloudflare.env;
  if (await wasApproved(env, nonce)) return { valid: false as const, approved: true, nonce };
  const req = await getApprovalRequest(env, nonce);
  if (!req) return { valid: false as const, approved: false, nonce };
  const when = new Date(req.at * 1000).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" });
  return { valid: true as const, approved: false, nonce, ip: req.ip, ua: req.ua, when };
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const form = await request.formData();
  const nonce = String(form.get("n") ?? "");
  const req = await getApprovalRequest(env, nonce);
  const ok = await approveLogin(env, nonce);
  // Approved in the same browser that is logging in (e.g. Telegram Desktop or
  // the phone itself): sign in right here and go to the portal's home page.
  if (ok && req && readChallengeToken(request) === req.token) {
    const res = await finishTelegramChallenge(request, env, true, "/admin");
    if (res instanceof Response) return res;
  }
  return { ok: ok || (await wasApproved(env, nonce)) };
}

function deviceLabel(ua: string): string {
  const os = /iPhone|iPad/.test(ua) ? "iPhone/iPad" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "";
  return [browser, os].filter(Boolean).join(" บน ") || "ไม่ทราบอุปกรณ์";
}

export default function ApproveLoginPage() {
  const data = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  return (
    <div className="w-full max-w-md">
      <div className="rounded-[24px] border border-line bg-white px-6 py-8 md:px-10 md:py-10">
        <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-yellow">
          <FaTelegram className="text-lg text-ink" aria-hidden="true" />
        </div>
        {result?.ok || data.approved ? (
          <>
            <h1 className="text-[26px] font-bold tracking-[-0.02em] text-ink">ยืนยันแล้ว</h1>
            <p className="mt-2 text-sm text-muted-ink">หน้าจอที่กำลังเข้าสู่ระบบจะเข้าหน้าแรกของ portal ให้เองภายในไม่กี่วินาที ปิดหน้านี้ได้เลย</p>
            <a href="/admin" className="mt-5 inline-flex h-10 items-center rounded-full border border-line px-5 text-[13px] font-semibold text-ink hover:bg-paper">ไปหน้าแรก</a>
          </>
        ) : !data.valid || result?.ok === false ? (
          <>
            <h1 className="text-[26px] font-bold tracking-[-0.02em] text-ink">ลิงก์นี้ใช้ไม่ได้แล้ว</h1>
            <p className="mt-2 text-sm text-muted-ink">ลิงก์หมดอายุ (5 นาที) ถูกใช้ไปแล้ว หรือมีคำขอใหม่กว่า กดส่งคำขอใหม่จากหน้าเข้าสู่ระบบ</p>
          </>
        ) : (
          <>
            <h1 className="text-[26px] font-bold tracking-[-0.02em] text-ink">ยืนยันการเข้าสู่ระบบ?</h1>
            <p className="mt-2 text-sm text-muted-ink">ยืนยันเฉพาะเมื่อคุณกำลังเข้าสู่ระบบอยู่ตอนนี้</p>
            <dl className="mt-5 space-y-2 rounded-2xl bg-paper px-4 py-3 text-sm">
              <div className="flex justify-between gap-3"><dt className="text-muted-ink">เวลา</dt><dd className="text-right text-ink">{data.when}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted-ink">อุปกรณ์</dt><dd className="text-right text-ink">{deviceLabel(data.ua)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted-ink">IP</dt><dd className="text-right tabular-nums text-ink">{data.ip || "-"}</dd></div>
            </dl>
            <Form method="post" className="mt-6">
              <input type="hidden" name="n" value={data.nonce} />
              <button type="submit" className="h-11 w-full rounded-full bg-ink text-[14px] font-semibold text-white transition-colors hover:bg-black">
                ยืนยัน ฉันกำลังเข้าสู่ระบบ
              </button>
            </Form>
            <p className="mt-4 text-xs text-muted-ink">ถ้าไม่ใช่คุณ ไม่ต้องกด ลิงก์จะหมดอายุเอง</p>
          </>
        )}
      </div>
    </div>
  );
}
