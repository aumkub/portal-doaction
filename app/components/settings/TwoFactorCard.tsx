import { Form, useNavigation } from "react-router";
import { useState } from "react";
import { FaShieldHalved, FaCopy, FaDownload } from "react-icons/fa6";
import { ConfirmButton } from "~/components/ui/confirm-button";

export interface TwoFactorCardState {
  enabled: boolean;
  enabledAt: number | null;
  recoveryRemaining: number;
  setup: { secret: string; qrSvg: string } | null;
}

export interface TwoFactorCardResult {
  error?: string;
  recoveryCodes?: string[];
  message?: string;
}

const pillPrimary =
  "inline-flex h-10 items-center rounded-full bg-ink px-5 text-[13px] font-semibold text-white hover:bg-black disabled:opacity-50 transition-colors";
const pillOutline =
  "inline-flex h-10 items-center gap-1.5 rounded-full border border-line bg-white px-5 text-[13px] font-semibold text-ink hover:bg-paper disabled:opacity-50 transition-colors";
const codeInput =
  "h-10 w-36 rounded-xl border border-line bg-white px-3.5 text-center text-sm tracking-[0.25em] focus:outline-none focus:ring-2 focus:ring-ink/10 focus:border-ink/40 transition";

function CodeInput() {
  return (
    <input
      name="code"
      type="text"
      required
      inputMode="numeric"
      autoComplete="one-time-code"
      pattern="[0-9]{6}"
      maxLength={6}
      placeholder="000000"
      aria-label="รหัส 6 หลัก"
      className={codeInput}
    />
  );
}

function RecoveryCodes({ codes }: { codes: string[] }) {
  const [copied, setCopied] = useState(false);
  const text = codes.join("\n");
  return (
    <div className="rounded-[14px] border border-line bg-paper p-4 space-y-3">
      <p className="text-sm font-semibold text-ink">Recovery codes</p>
      <p className="text-xs text-muted-ink">
        เก็บรหัสเหล่านี้ไว้ในที่ปลอดภัย จะแสดงเพียงครั้งเดียว แต่ละรหัสใช้ได้ครั้งเดียวเมื่อเข้าแอป Authenticator ไม่ได้
      </p>
      <ul className="grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-sm text-ink">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={pillOutline}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
        >
          <FaCopy className="text-[11px]" aria-hidden="true" />
          {copied ? "คัดลอกแล้ว" : "คัดลอก"}
        </button>
        <a
          className={pillOutline}
          download="doaction-portal-recovery-codes.txt"
          href={`data:text/plain;charset=utf-8,${encodeURIComponent(
            `do action portal — recovery codes\n\n${text}\n`
          )}`}
        >
          <FaDownload className="text-[11px]" aria-hidden="true" />
          ดาวน์โหลด .txt
        </a>
      </div>
    </div>
  );
}

/** Mirrors the settings page SectionCard so the card sits in either page. */
function SectionCard({ icon, title, subtitle, children }: {
  icon: React.ReactNode; title: string; subtitle?: string; children: React.ReactNode;
}) {
  return (
    <section className="bg-white rounded-[20px] border border-line overflow-hidden">
      <div className="flex items-center gap-3 px-6 py-5 border-b border-line-soft">
        <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-paper text-ink shrink-0 text-sm">
          {icon}
        </span>
        <div>
          <p className="text-[16px] font-semibold text-ink">{title}</p>
          {subtitle && <p className="text-xs text-muted-ink mt-0.5">{subtitle}</p>}
        </div>
      </div>
      <div className="p-6">{children}</div>
    </section>
  );
}

export function TwoFactorCard({
  state,
  result,
}: {
  state: TwoFactorCardState;
  result?: TwoFactorCardResult | null;
}) {
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const status = state.enabled
    ? `เปิดใช้งานแล้ว · recovery codes เหลือ ${state.recoveryRemaining} รหัส`
    : "ยังไม่ได้เปิดใช้งาน";

  return (
    <SectionCard icon={<FaShieldHalved />} title="การยืนยันตัวตนสองขั้น (2FA)" subtitle={status}>
      <div className="space-y-4">
        {result?.message && <p className="text-xs text-emerald-600">{result.message}</p>}
        {result?.error && <p className="text-xs text-[#B4541A]">{result.error}</p>}
        {result?.recoveryCodes && <RecoveryCodes codes={result.recoveryCodes} />}

        {!state.enabled && !state.setup && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-ink">
              ใช้แอป Authenticator (Google Authenticator, 1Password ฯลฯ) สร้างรหัสเพิ่มตอนเข้าสู่ระบบ
            </p>
            <Form method="post">
              <input type="hidden" name="intent" value="2fa_start" />
              <button type="submit" disabled={busy} className={pillPrimary}>
                เปิดใช้ 2FA
              </button>
            </Form>
          </div>
        )}

        {!state.enabled && state.setup && (
          <div className="grid gap-5 sm:grid-cols-[180px_1fr] items-start">
            <div
              className="w-[180px] rounded-[14px] border border-line bg-white p-2 [&>svg]:h-auto [&>svg]:w-full"
              aria-label="QR code สำหรับแอป Authenticator"
              dangerouslySetInnerHTML={{ __html: state.setup.qrSvg }}
            />
            <div className="space-y-3">
              <p className="text-sm text-ink">1. สแกน QR code ด้วยแอป Authenticator</p>
              <div>
                <p className="text-xs text-muted-ink mb-1">หรือกรอก secret ด้วยตนเอง</p>
                <code className="block break-all rounded-xl bg-paper border border-line-soft px-3 py-2 font-mono text-xs text-ink">
                  {state.setup.secret.replace(/(.{4})/g, "$1 ").trim()}
                </code>
              </div>
              <p className="text-sm text-ink">2. กรอกรหัส 6 หลักเพื่อยืนยัน</p>
              <div className="flex flex-wrap items-center gap-2">
                <Form method="post" className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="intent" value="2fa_confirm" />
                  <CodeInput />
                  <button type="submit" disabled={busy} className={pillPrimary}>
                    ยืนยันและเปิดใช้
                  </button>
                </Form>
                <Form method="post">
                  <input type="hidden" name="intent" value="2fa_cancel" />
                  <button type="submit" disabled={busy} className={pillOutline}>
                    ยกเลิก
                  </button>
                </Form>
              </div>
            </div>
          </div>
        )}

        {state.enabled && (
          <div className="space-y-4">
            <Form method="post" className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="intent" value="2fa_regen" />
              <CodeInput />
              <ConfirmButton
                className={pillOutline}
                disabled={busy}
                confirmLabel="สร้าง recovery codes ใหม่"
                message="recovery codes ชุดเดิมทั้งหมดจะใช้ไม่ได้อีก"
              >
                สร้าง recovery codes ใหม่
              </ConfirmButton>
            </Form>
            <Form method="post" className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="intent" value="2fa_disable" />
              <CodeInput />
              <ConfirmButton
                className={pillOutline}
                disabled={busy}
                destructive
                confirmLabel="ปิด 2FA"
                message="บัญชีจะเข้าสู่ระบบได้ด้วยรหัสผ่านอย่างเดียว"
              >
                ปิด 2FA
              </ConfirmButton>
            </Form>
          </div>
        )}
      </div>
    </SectionCard>
  );
}
