import { redirect } from "react-router";
import type { Route } from "./+types/magic-link";
import { createAuth } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const token = new URL(request.url).searchParams.get("token");

  if (!token) return redirect("/login");

  const db = createDB(env.DB);
  const record = await db.getMagicLinkToken(token);

  if (!record) {
    return { error: "ลิ้งก์นี้ไม่ถูกต้องหรือหมดอายุแล้ว กรุณาขอลิ้งก์ใหม่อีกครั้ง" };
  }

  await db.markMagicLinkUsed(record.id);

  const { lucia } = createAuth(env.DB, env.SESSIONPORTAL);
  const session = await lucia.createSession(record.user_id, {});
  const sessionCookie = lucia.createSessionCookie(session.id);

  const user = await db.getUserById(record.user_id);
  if (user?.first_login_at == null) {
    await db.updateUser(record.user_id, {
      first_login_at: Math.floor(Date.now() / 1000),
    });
  }
  const destination = user?.role === "admin" ? "/admin/clients" : "/dashboard";

  return redirect(destination, {
    headers: { "Set-Cookie": sessionCookie.serialize() },
  });
}

export default function MagicLinkVerify({ loaderData }: Route.ComponentProps) {
  const error = (loaderData as { error?: string } | null)?.error;

  if (error) {
    return (
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-10 text-center space-y-4">
        <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto">
          <span className="text-3xl">⚠️</span>
        </div>
        <h2 className="text-lg font-semibold text-slate-900">ลิ้งก์ไม่ถูกต้อง</h2>
        <p className="text-sm text-slate-500 leading-relaxed">{error}</p>
        <a
          href="/login"
          className="inline-block mt-2 px-5 py-2.5 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 transition-colors"
        >
          ขอลิ้งก์ใหม่
        </a>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-10 text-center">
      <div className="w-16 h-16 bg-violet-50 rounded-full flex items-center justify-center mx-auto mb-4">
        <span className="text-3xl">⏳</span>
      </div>
      <p className="text-slate-600 text-sm">กำลังเข้าสู่ระบบ…</p>
    </div>
  );
}
