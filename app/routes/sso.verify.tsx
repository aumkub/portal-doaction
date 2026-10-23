import { Form, redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/sso.verify";
import { redeemSsoToken } from "~/lib/sso.server";

export function meta() {
  return [{ title: "ยืนยันการเข้าสู่ระบบ — do action portal" }, { name: "referrer", content: "no-referrer" }];
}

/**
 * The link in the confirmation email. GET only shows a button: mail
 * scanners that open links must not use up the one-time token.
 */
export function loader({ request }: Route.LoaderArgs) {
  const t = new URL(request.url).searchParams.get("t") ?? "";
  return { token: /^[0-9a-f]{64}$/.test(t) ? t : "" };
}

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const res = await redeemSsoToken(context.cloudflare.env, request, "verify", String(form.get("token") ?? ""));
  return res ?? redirect("/login?redirect=%2Ftickets%2Fnew");
}

export default function SsoVerifyPage() {
  const { token } = useLoaderData<typeof loader>();
  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4">
      <div className="w-full max-w-md rounded-[24px] border border-line bg-white px-6 py-8 text-center">
        <h1 className="text-[22px] font-bold text-ink">ยืนยันการเข้าสู่ระบบ</h1>
        {token ? (
          <>
            <p className="mt-2 text-sm text-muted-ink">กดยืนยันเพื่อเข้า portal ครั้งต่อไปกดปุ่มในเว็บไซต์ของคุณได้เลยโดยไม่ต้องยืนยันอีก</p>
            <Form method="post" className="mt-6">
              <input type="hidden" name="token" value={token} />
              <button type="submit" className="h-11 w-full rounded-full bg-ink text-[14px] font-semibold text-white hover:bg-black">
                ยืนยันและเข้าสู่ระบบ
              </button>
            </Form>
          </>
        ) : (
          <p className="mt-2 text-sm text-muted-ink">ลิงก์ไม่ถูกต้องหรือหมดอายุ กดปุ่มในเว็บไซต์ของคุณอีกครั้งเพื่อขอลิงก์ใหม่</p>
        )}
      </div>
    </div>
  );
}
