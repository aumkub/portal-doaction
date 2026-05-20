import { Form, useActionData, useNavigation, redirect } from "react-router";
import type { Route } from "./+types/login";
import { createDB } from "~/lib/db.server";
import { verifyPassword, createAuth, generateMagicToken } from "~/lib/auth.server";
import { sendMagicLinkEmail } from "~/lib/email.server";
import { parseClientCcEmails } from "~/lib/client-cc";
import { useT } from "~/lib/i18n";
import { z } from "zod";
import { FaEnvelope, FaLock, FaArrowRight, FaChevronDown } from "react-icons/fa6";

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

  if (mode === "password") {
    if (!password || !user || (user.role !== "admin" && user.role !== "co-admin")) {
      return { errors: { email: ["อีเมลหรือรหัสผ่านไม่ถูกต้อง"] }, sent: false };
    }
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
    const dest =
      new URL(request.url).searchParams.get("redirect") ??
      (user.role === "co-admin" ? "/admin" : "/admin/clients");
    return redirect(dest, { headers: { "Set-Cookie": cookie.serialize() } });
  }

  if (user && user.role === "co-admin") {
    return {
      errors: { email: ["Co-Admin ต้องเข้าสู่ระบบด้วยรหัสผ่าน"] },
      sent: false,
    };
  }

  if (user) {
    const { id, token, expires_at } = generateMagicToken();
    await db.createMagicLinkToken({ id, user_id: user.id, token, expires_at, used: 0 });
    const origin = new URL(request.url).origin;
    const magicUrl = `${origin}/magic-link?token=${token}`;
    const client = await db.getClientByUserId(user.id);
    const ccRecipients = parseClientCcEmails(client?.cc_emails).map((ccEmail) => ({ email: ccEmail }));
    if (env.SEND_EMAIL) {
      try {
        await sendMagicLinkEmail({
          to: email,
          toName: user.name,
          cc: ccRecipients.length > 0 ? ccRecipients : undefined,
          magicUrl,
          sendEmail: env.SEND_EMAIL,
          db,
          source: "login_magic_link",
          lang: user.language === "en" ? "en" : "th",
        });
      } catch (err) {
        console.error("[magic-link] send failed:", err);
      }
    }
  }

  return { sent: true, errors: null };
}

const inputCls =
  "w-full h-11 rounded-xl border border-slate-200 bg-white pl-10 pr-4 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-400 transition";

export default function LoginPage() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const { t } = useT?.() ?? { t: (key: string) => key };
  const isSubmitting = navigation.state === "submitting";
  const submittingMode = navigation.formData?.get("mode");
  const isSubmittingMagic = isSubmitting && submittingMode === "magic";
  const isSubmittingAdmin = isSubmitting && submittingMode === "password";

  /* ── Sent confirmation screen ─────────────────────────────────── */
  if (actionData?.sent) {
    return (
      <div className="w-full max-w-sm">
        <div className="bg-white rounded-2xl shadow-xl p-8 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-violet-50 mx-auto mb-5">
            <FaEnvelope className="text-2xl text-violet-500" />
          </div>
          <h2 className="text-lg font-semibold text-slate-900 mb-2">ตรวจสอบอีเมลของคุณ</h2>
          <p className="text-sm text-slate-500 leading-relaxed">
            เราได้ส่งลิ้งก์เข้าสู่ระบบไปยังอีเมลของคุณแล้ว
            <br />
            ลิ้งก์จะหมดอายุใน{" "}
            <span className="font-semibold text-slate-700">15 นาที</span>
          </p>
          <Form method="post" className="mt-6">
            <input type="hidden" name="mode" value="magic" />
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 text-sm text-violet-600 hover:text-violet-700 font-medium transition-colors"
            >
              ส่งลิ้งก์อีกครั้ง
            </button>
          </Form>
        </div>
        <p className="text-center text-xs text-slate-500 mt-4">
          do action client portal
        </p>
      </div>
    );
  }

  /* ── Main login form ──────────────────────────────────────────── */
  return (
    <div className="w-full max-w-sm">
      <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
        {/* Top accent */}
        <div className="h-1 w-full bg-linear-to-r from-violet-500 via-purple-500 to-indigo-500" />

        <div className="px-8 pt-8 pb-8">
          {/* Logo */}
          <div className="relative mb-8 text-center isolate">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-10 -inset-y-3 rounded-3xl bg-linear-to-r from-violet-100/60 via-indigo-100/50 to-cyan-100/50 blur-2xl animate-pulse"
            />
            <div
              aria-hidden
              className="pointer-events-none absolute left-1/2 top-1/2 h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full border border-violet-200/60 animate-[spin_16s_linear_infinite]"
            />
            <div className="relative inline-flex rounded-2xl bg-white/85 px-4 py-2 shadow-sm ring-1 ring-slate-100">
              <img src="/logo-dark.svg" alt="do action" className="h-16 mx-auto" />
            </div>
            <p className="mt-2 text-[10px] font-bold tracking-[0.2em] text-slate-400 uppercase">
              Client Portal
            </p>
          </div>

          {/* Heading */}
          <div className="mb-6">
            <h1 className="text-xl font-semibold text-slate-900">ยินดีต้อนรับ</h1>
            <p className="text-sm text-slate-500 mt-1">
              กรอกอีเมลเพื่อรับลิ้งก์เข้าสู่ระบบ
            </p>
          </div>

          {/* Magic link form */}
          <Form method="post" className="space-y-4">
            <input type="hidden" name="mode" value="magic" />

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-600">อีเมล</label>
              <div className="relative">
                <FaEnvelope className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs" />
                <input
                  name="email"
                  type="email"
                  required
                  autoFocus
                  placeholder="you@example.com"
                  className={inputCls}
                />
              </div>
              {actionData?.errors?.email && (
                <p className="text-xs text-red-500">{actionData.errors.email[0]}</p>
              )}
            </div>

            <button
              type="submit"
              disabled={isSubmittingMagic}
              className="w-full h-11 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
            >
              {isSubmittingMagic ? (
                "กำลังส่ง…"
              ) : (
                <>
                  {t("auth_btn_send_magic_link")}
                  <FaArrowRight className="text-xs opacity-70" />
                </>
              )}
            </button>
          </Form>

          {/* Admin divider */}
          <div className="mt-6 pt-5 border-t border-slate-100">
            <details className="group">
              <summary className="flex items-center justify-center gap-1.5 text-xs text-slate-500 cursor-pointer hover:text-slate-700 transition-colors list-none select-none">
                ผู้ดูแลระบบ / Co-Admin
                <FaChevronDown className="text-[9px] transition-transform group-open:rotate-180" />
              </summary>

              <Form method="post" className="mt-4 space-y-3">
                <input type="hidden" name="mode" value="password" />

                <div className="relative">
                  <FaEnvelope className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs" />
                  <input
                    name="email"
                    type="email"
                    required
                    placeholder="admin@doaction.co.th"
                    className={inputCls}
                  />
                </div>

                <div className="relative">
                  <FaLock className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs" />
                  <input
                    name="password"
                    type="password"
                    required
                    placeholder="••••••••"
                    className={inputCls}
                  />
                </div>

                <button
                  type="submit"
                  disabled={isSubmittingAdmin}
                  className="w-full h-11 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors"
                >
                  {isSubmittingAdmin ? "กำลังเข้าสู่ระบบ…" : "เข้าสู่ระบบ (Admin / Co-Admin)"}
                </button>
              </Form>
            </details>
          </div>
        </div>
      </div>

      <p className="text-center text-xs text-slate-500 mt-4">
        do action client portal
      </p>
    </div>
  );
}
