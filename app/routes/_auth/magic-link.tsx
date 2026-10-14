import { redirect } from "react-router";
import type { Route } from "./+types/magic-link";
import { createAuth, evictUserCache } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";
import { FaTriangleExclamation, FaSpinner } from "react-icons/fa6";

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
    await evictUserCache(env.SESSIONPORTAL, record.user_id);
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
      <div className="w-full max-w-md bg-white rounded-[24px] border border-line p-8 md:p-10 text-center space-y-4">
        <div className="w-12 h-12 bg-[#FDE7DA] rounded-2xl flex items-center justify-center mx-auto">
          <FaTriangleExclamation className="text-base text-[#B4541A]" aria-hidden="true" />
        </div>
        <h2 className="text-[24px] font-bold tracking-[-0.02em] text-ink">ลิ้งก์ไม่ถูกต้อง</h2>
        <p className="text-sm text-muted-ink leading-relaxed">{error}</p>
        <a
          href="/login"
          className="inline-flex items-center h-10 mt-2 px-5 rounded-full bg-ink text-white text-[13px] font-semibold hover:bg-black transition-colors"
        >
          ขอลิ้งก์ใหม่
        </a>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md bg-white rounded-[24px] border border-line p-8 md:p-10 text-center">
      <div className="w-12 h-12 bg-brand-yellow rounded-2xl flex items-center justify-center mx-auto mb-4">
        <FaSpinner className="text-base text-ink animate-spin" aria-hidden="true" />
      </div>
      <p className="text-muted-ink text-sm">กำลังเข้าสู่ระบบ…</p>
    </div>
  );
}
