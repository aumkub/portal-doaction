import { Form, useActionData, useNavigation, redirect } from "react-router";
import { useState } from "react";
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

const LOCAL_ADMIN_EMAIL = "aum@doaction.co.th";

function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const formData = await request.formData();
  const raw = Object.fromEntries(formData);
  const mode = typeof raw.mode === "string" ? raw.mode : "magic";
  const db = createDB(env.DB);

  if (mode === "local_admin_bypass") {
    const hostname = new URL(request.url).hostname;
    if (!isLocalHost(hostname)) {
      return { errors: { email: ["Local bypass ใช้ได้เฉพาะบน localhost"] }, sent: false };
    }

    let localAdminUser = await db.getUserByEmail(LOCAL_ADMIN_EMAIL);
    if (!localAdminUser) {
      const { generateId } = await import("~/lib/utils");
      const now = Math.floor(Date.now() / 1000);
      await env.DB.prepare(
        `INSERT INTO users (id, email, name, role, created_at, updated_at) VALUES (?, ?, ?, 'admin', ?, ?)`
      ).bind(generateId(), LOCAL_ADMIN_EMAIL, "Aum (local)", now, now).run();
      localAdminUser = await db.getUserByEmail(LOCAL_ADMIN_EMAIL);
    }
    if (!localAdminUser) {
      return { errors: { email: ["สร้าง admin user ไม่สำเร็จ"] }, sent: false };
    }

    const { lucia } = createAuth(env.DB, env.SESSIONPORTAL);
    const session = await lucia.createSession(localAdminUser.id, {});
    const cookie = lucia.createSessionCookie(session.id);
    const dest = new URL(request.url).searchParams.get("redirect") ?? "/admin/clients";
    return redirect(dest, { headers: { "Set-Cookie": cookie.serialize() } });
  }

  const parsed = Schema.safeParse(raw);

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors, sent: false };
  }

  const { email, mode: loginMode, password } = parsed.data;
  const user = await db.getUserByEmail(email);

  if (loginMode === "password") {
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
  "w-full h-11 rounded-xl border border-line bg-white pl-10 pr-3.5 text-sm text-ink placeholder:text-faint-ink focus:outline-none focus:border-ink/40 focus:ring-2 focus:ring-ink/10 transition"

export default function LoginPage() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const { t } = useT?.() ?? { t: (key: string) => key };
  const isSubmitting = navigation.state === "submitting";
  const submittingMode = navigation.formData?.get("mode");
  const isSubmittingMagic = isSubmitting && submittingMode === "magic";
  const isSubmittingAdmin = isSubmitting && submittingMode === "password";
  const isSubmittingBypass = isSubmitting && submittingMode === "local_admin_bypass";
  const showLocalBypass = import.meta.env.DEV;
  const [showAdminForm, setShowAdminForm] = useState(false);

  /* ── Sent confirmation screen ─────────────────────────────────── */
  if (actionData?.sent) {
    return (
      <div className="w-full max-w-md">
        <div className="bg-white rounded-[24px] border border-line p-8 md:p-10 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-yellow mx-auto mb-5">
            <FaEnvelope className="text-base text-ink" />
          </div>
          <h2 className="text-[24px] font-bold tracking-[-0.02em] text-ink mb-2">ตรวจสอบอีเมลของคุณ</h2>
          <p className="text-sm text-muted-ink leading-relaxed">
            เราได้ส่งลิ้งก์เข้าสู่ระบบไปยังอีเมลของคุณแล้ว
            <br />
            ลิ้งก์จะหมดอายุใน{" "}
            <span className="font-semibold text-ink">15 นาที</span>
          </p>
          <Form method="post" className="mt-6">
            <input type="hidden" name="mode" value="magic" />
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 h-10 rounded-full border border-line bg-white px-5 text-[13px] text-ink hover:bg-paper font-semibold transition-colors"
            >
              ส่งลิ้งก์อีกครั้ง
            </button>
          </Form>
        </div>
      </div>
    );
  }

  /* ── Main login form ──────────────────────────────────────────── */
  return (
    <div className="w-full max-w-md">
      <div className="bg-white rounded-[24px] border border-line overflow-hidden">
        <div className="px-6 py-8 md:px-10 md:py-10">
          <span className="mb-5 inline-flex items-center gap-1.5 rounded-full bg-brand-yellow px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink">
            Client Portal
          </span>

          {/* Heading */}
          <div className="mb-7">
            <h1 className="text-[32px] md:text-[36px] font-bold leading-tight tracking-[-0.02em] text-ink">ยินดีต้อนรับ</h1>
            <p className="text-sm text-muted-ink mt-2">
              กรอกอีเมลเพื่อรับลิ้งก์เข้าสู่ระบบ
            </p>
          </div>

          {/* Magic link form */}
          <Form method="post" className="space-y-4">
            <input type="hidden" name="mode" value="magic" />

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-ink">อีเมล</label>
              <div className="relative">
                <FaEnvelope className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-faint-ink text-xs" />
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
                <p className="text-xs text-[#B4541A]">{actionData.errors.email[0]}</p>
              )}
            </div>

            <button
              type="submit"
              disabled={isSubmittingMagic}
              className="w-full h-11 rounded-full bg-ink text-white text-[14px] font-semibold hover:bg-black disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
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
          <div className="mt-6 pt-5 border-t border-line-soft">
            <button
              type="button"
              onClick={() => setShowAdminForm((v) => !v)}
              className="w-full flex items-center justify-center gap-2 text-xs text-muted-ink hover:text-ink transition-colors py-1 select-none"
            >
              <FaLock className="text-[10px] opacity-60" />
              <span>ผู้ดูแลระบบ / Co-Admin</span>
              <FaChevronDown
                className={`text-[9px] transition-transform duration-200 ${showAdminForm ? "rotate-180" : ""}`}
              />
            </button>

            {showAdminForm && (
              <div className="mt-4 rounded-[16px] border border-line bg-paper p-4 space-y-3">
                <div className="flex items-center gap-2 mb-1">
                  <FaLock className="text-faint-ink text-[11px]" />
                  <span className="text-xs font-semibold text-ink-soft uppercase tracking-wide">
                    เข้าสู่ระบบด้วยรหัสผ่าน
                  </span>
                </div>

                <Form method="post" className="space-y-2.5">
                  <input type="hidden" name="mode" value="password" />

                  <div className="relative">
                    <FaEnvelope className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-faint-ink text-xs" />
                    <input
                      name="email"
                      type="email"
                      required
                      placeholder="admin@doaction.co.th"
                      className={inputCls}
                    />
                  </div>

                  <div className="relative">
                    <FaLock className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-faint-ink text-xs" />
                    <input
                      name="password"
                      type="password"
                      required
                      placeholder="••••••••"
                      className={inputCls}
                    />
                  </div>

                  {actionData?.errors?.email && (
                    <p className="text-xs text-[#B4541A]">{actionData.errors.email[0]}</p>
                  )}

                  <button
                    type="submit"
                    disabled={isSubmittingAdmin}
                    className="w-full h-10 rounded-full bg-ink text-white text-[13px] font-semibold hover:bg-black disabled:opacity-50 transition-colors"
                  >
                    {isSubmittingAdmin ? "กำลังเข้าสู่ระบบ…" : "เข้าสู่ระบบ"}
                  </button>
                </Form>

                {showLocalBypass ? (
                  <Form method="post">
                    <input type="hidden" name="mode" value="local_admin_bypass" />
                    <button
                      type="submit"
                      disabled={isSubmittingBypass}
                      className="w-full h-10 rounded-full border border-line bg-white text-[13px] font-semibold text-ink hover:bg-paper disabled:opacity-50 transition-colors"
                    >
                      {isSubmittingBypass ? "กำลัง bypass..." : `⚡ Local bypass → ${LOCAL_ADMIN_EMAIL}`}
                    </button>
                  </Form>
                ) : null}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
