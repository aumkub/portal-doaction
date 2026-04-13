import { Form, useActionData, useNavigation, redirect } from "react-router";
import type { Route } from "./+types/login";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { createDB } from "~/lib/db.server";
import { verifyPassword, createAuth, generateMagicToken } from "~/lib/auth.server";
import { sendMagicLinkEmail } from "~/lib/email.server";
import { useT } from "~/lib/i18n";
import { z } from "zod";

export function meta() {
  return [{ title: "เข้าสู่ระบบ — do action portal" }];
}

const Schema = z.object({
  email: z.string().email("รูปแบบอีเมลไม่ถูกต้อง"),
  mode: z.enum(["magic", "password"]).default("magic"),
  password: z.string().optional(),
});

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const formData = await request.formData();
  const raw = Object.fromEntries(formData);
  const parsed = Schema.safeParse(raw);

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors, sent: false };
  }

  const { email, mode, password } = parsed.data;
  const db = createDB(env.DB);
  const user = await db.getUserByEmail(email);

  // ── Admin password login ──────────────────────────────────────────────────
  if (mode === "password") {
    if (!password || !user || (user.role !== "admin" && user.role !== "co-admin")) {
      return { errors: { email: ["อีเมลหรือรหัสผ่านไม่ถูกต้อง"] }, sent: false };
    }
    // Co-admins use password_hash from users table
    // Admins use password_hash from KV (legacy)
    let storedHash: string | null = null;
    if (user.role === "co-admin") {
      storedHash = user.password_hash;
    } else {
      storedHash = await env.SESSIONPORTAL.get(`pw:${user.id}`);
    }
    if (!storedHash || !(await verifyPassword(password, storedHash))) {
      return { errors: { email: ["อีเมลหรือรหัสผ่านไม่ถูกต้อง"] }, sent: false };
    }
    const { lucia } = createAuth(env.DB, env.SESSIONPORTAL);
    const session = await lucia.createSession(user.id, {});
    const cookie = lucia.createSessionCookie(session.id);
    // Redirect co-admins and admins to their respective pages
    const dest = new URL(request.url).searchParams.get("redirect") ??
      (user.role === "co-admin" ? "/admin" : "/admin/clients");
    return redirect(dest, { headers: { "Set-Cookie": cookie.serialize() } });
  }

  // ── Magic link (default) ───────────────────────────────────────────────────
  // Co-admins cannot use magic link
  if (user && user.role === "co-admin") {
    return { errors: { email: ["Co-admins must use password login. Magic link is not supported for co-admins."] }, sent: false };
  }
  if (user) {
    const { id, token, expires_at } = generateMagicToken();
    await db.createMagicLinkToken({ id, user_id: user.id, token, expires_at, used: 0 });

    const origin = new URL(request.url).origin;
    const magicUrl = `${origin}/magic-link?token=${token}`;

    try {
      await sendMagicLinkEmail({
        to: email,
        toName: user.name,
        magicUrl,
        apiKey: env.SMTP2GO_API_KEY,
        db,
        source: "login_magic_link",
      });
    } catch (err) {
      console.error("[magic-link] send failed:", err);
      // Don't leak sending errors to the client
    }
  }

  // Always return success to prevent email enumeration
  return { sent: true, errors: null };
}

export default function LoginPage() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const { t } = useT?.() ?? { t: (key: string) => key }; // Fallback for SSR
  const isSubmitting = navigation.state === "submitting";
  const submittingMode = navigation.formData?.get("mode");
  const isSubmittingMagic = isSubmitting && submittingMode === "magic";
  const isSubmittingAdmin = isSubmitting && submittingMode === "password";

  if (actionData?.sent) {
    return (
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-10 text-center">
        <div className="w-16 h-16 bg-violet-50 rounded-full flex items-center justify-center mx-auto mb-4">
          <span className="text-3xl">📬</span>
        </div>
        <h2 className="text-xl font-semibold text-slate-900 mb-2">
          ตรวจสอบอีเมลของคุณ
        </h2>
        <p className="text-sm text-slate-500 leading-relaxed">
          เราได้ส่งลิ้งก์เข้าสู่ระบบไปยัง email ของคุณแล้ว
          <br />
          ลิ้งก์จะหมดอายุใน <span className="font-medium text-slate-700">15 นาที</span>
        </p>
        <Form method="post" className="mt-6">
          <input type="hidden" name="mode" value="magic" />
          <button
            type="submit"
            className="text-sm text-violet-600 hover:text-violet-700 underline underline-offset-2"
          >
            {t("auth_btn_send_magic_link")}
          </button>
        </Form>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-10">
      {/* Logo */}
      <div className="mb-8">
        <div className="flex items-center gap-3">
          <img
            src="/logo-dark.svg"
            alt="do action"
            className="w-[200px] mx-auto"
          />
        </div>
        <p className="block text-center text-sm text-black mt-0 tracking-widest font-bold">
          CLIENT PORTAL
        </p>
      </div>

      {/* Heading */}
      <h1 className="text-xl font-semibold text-slate-900 mb-1">
        ยินดีต้อนรับ
      </h1>
      <p className="text-sm text-slate-500 mb-7">
        เราจะส่งลิ้งก์เข้าระบบไปยัง email ของคุณ
      </p>

      <Form method="post" className="space-y-4" id="magic-form">
        <input type="hidden" name="mode" value="magic" />

        <div className="space-y-1.5">
          <Label htmlFor="email">อีเมล</Label>
          <Input
            id="email"
            name="email"
            type="email"
            required
            autoFocus
            placeholder="you@example.com"
            className="h-11"
          />
          {actionData?.errors?.email && (
            <p className="text-red-500 text-xs">{actionData.errors.email[0]}</p>
          )}
        </div>

        <Button
          type="submit"
          disabled={isSubmittingMagic}
          className="w-full h-11 bg-violet-600 hover:bg-violet-700 text-white"
        >
          {isSubmittingMagic ? "กำลังส่ง…" : t("auth_btn_send_magic_link")}
        </Button>
      </Form>

      {/* Admin / Co-Admin divider */}
      <div className="mt-6 pt-6 border-t border-slate-100">
        <details className="group">
          <summary className="text-xs text-slate-400 cursor-pointer hover:text-slate-600 transition-colors list-none text-center">
            ผู้ดูแลระบบ / Co-Admin? เข้าสู่ระบบด้วยรหัสผ่าน
          </summary>
          <Form method="post" className="mt-4 space-y-3">
            <input type="hidden" name="mode" value="password" />
            <Input
              name="email"
              type="email"
              required
              placeholder="a@doaction.co.th"
              className="h-11"
            />
            <Input
              name="password"
              type="password"
              required
              placeholder="••••••••"
              className="h-11"
            />
            <Button
              type="submit"
              variant="outline"
              className="w-full h-11"
              disabled={isSubmittingAdmin}
            >
              {isSubmittingAdmin ? "กำลังเข้าสู่ระบบ…" : `${t("auth_btn_sign_in")} (Admin / Co-Admin)`}
            </Button>
          </Form>
        </details>
      </div>
    </div>
  );
}
