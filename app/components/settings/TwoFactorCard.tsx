import { Form, useFetcher, useNavigation, useSubmit } from "react-router";
import { useEffect, useRef, useState } from "react";
import { FaShieldHalved, FaCopy, FaDownload, FaKey, FaMobileScreen } from "react-icons/fa6";
import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import { ConfirmButton } from "~/components/ui/confirm-button";
import { formatDate } from "~/lib/utils";

export interface TwoFactorCardState {
  enabled: boolean;
  method: "totp" | "passkey" | null;
  enabledAt: number | null;
  recoveryRemaining: number;
  setup: { secret: string; qrSvg: string } | null;
  passkeys: { id: string; name: string | null; createdAt: number; lastUsedAt: number | null }[];
}

export interface TwoFactorCardResult {
  error?: string;
  recoveryCodes?: string[];
  message?: string;
}

type OptionsResult = {
  twoFactor?: { error?: string; passkeyOptions?: unknown; passkeyAuthOptions?: unknown };
};

/**
 * Drives the browser's WebAuthn prompt. Options come from the route action via
 * a fetcher; the signed result is then posted as a normal navigation submit so
 * the page's actionData (messages, recovery codes) updates as with any form.
 */
function usePasskeyFlow() {
  const fetcher = useFetcher<OptionsResult>();
  const submit = useSubmit();
  const pending = useRef<{ kind: "register" | "auth"; fields: Record<string, string> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prompting, setPrompting] = useState(false);

  useEffect(() => {
    const data = fetcher.data?.twoFactor;
    const job = pending.current;
    if (!data || !job || fetcher.state !== "idle") return;
    pending.current = null;
    if (data.error) {
      setError(data.error);
      return;
    }
    setPrompting(true);
    const run =
      job.kind === "register" && data.passkeyOptions
        ? startRegistration({ optionsJSON: data.passkeyOptions as PublicKeyCredentialCreationOptionsJSON }).then(
            (res) => ({ ...job.fields, response: JSON.stringify(res) })
          )
        : job.kind === "auth" && data.passkeyAuthOptions
          ? startAuthentication({ optionsJSON: data.passkeyAuthOptions as PublicKeyCredentialRequestOptionsJSON }).then(
              (res) => ({ ...job.fields, assertion: JSON.stringify(res) })
            )
          : Promise.reject(new Error("no options"));
    run
      .then((fields) => submit(fields, { method: "post" }))
      .catch(() => setError("ยกเลิกหรือดำเนินการด้วย passkey ไม่สำเร็จ"))
      .finally(() => setPrompting(false));
  }, [fetcher.data, fetcher.state, submit]);

  return {
    error,
    busy: fetcher.state !== "idle" || prompting,
    register(name: string) {
      setError(null);
      pending.current = { kind: "register", fields: { intent: "pk_reg_verify", name } };
      fetcher.submit({ intent: "pk_reg_options" }, { method: "post" });
    },
    /** Fresh assertion, then posts `intent` with it. */
    authThen(intent: string) {
      setError(null);
      pending.current = { kind: "auth", fields: { intent } };
      fetcher.submit({ intent: "pk_auth_options" }, { method: "post" });
    },
  };
}

function useWebAuthnSupport() {
  const [supported, setSupported] = useState<boolean | null>(null);
  useEffect(() => setSupported(browserSupportsWebAuthn()), []);
  return supported;
}

const nameInput =
  "h-10 w-full sm:w-52 rounded-xl border border-line bg-white px-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-ink/10 focus:border-ink/40 transition";

function PasskeyNameForm({ label, flow }: { label: string; flow: ReturnType<typeof usePasskeyFlow> }) {
  const [name, setName] = useState("");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={60}
        placeholder="ชื่ออุปกรณ์ (ไม่บังคับ) เช่น MacBook"
        aria-label="ชื่ออุปกรณ์"
        className={nameInput}
      />
      <button type="button" disabled={flow.busy} className={pillPrimary} onClick={() => flow.register(name.trim())}>
        {flow.busy ? "กำลังดำเนินการ…" : label}
      </button>
    </div>
  );
}

function RecoveryDisableForm({ busy }: { busy: boolean }) {
  return (
    <Form method="post" className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="intent" value="2fa_disable" />
      <input
        name="recovery"
        type="text"
        required
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        placeholder="xxxx-xxxx"
        aria-label="Recovery code"
        className={codeInput}
      />
      <ConfirmButton
        className={pillOutline}
        disabled={busy}
        destructive
        confirmLabel="ปิด 2FA"
        message="ใช้ recovery code ปิด 2FA — passkey และ recovery codes ทั้งหมดจะถูกลบ"
      >
        ปิด 2FA ด้วย recovery code
      </ConfirmButton>
    </Form>
  );
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
        เก็บรหัสเหล่านี้ไว้ในที่ปลอดภัย จะแสดงเพียงครั้งเดียว แต่ละรหัสใช้ได้ครั้งเดียวเมื่อใช้แอป Authenticator หรือ passkey ไม่ได้
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
  const flow = usePasskeyFlow();
  const webauthn = useWebAuthnSupport();
  const methodLabel = state.method === "passkey" ? "Passkey" : "แอป Authenticator";
  const status = state.enabled
    ? `เปิดใช้งานแล้ว (${methodLabel}) · recovery codes เหลือ ${state.recoveryRemaining} รหัส`
    : "ยังไม่ได้เปิดใช้งาน";
  const onlyOne = state.passkeys.length <= 1;

  return (
    <SectionCard icon={<FaShieldHalved />} title="การยืนยันตัวตนสองขั้น (2FA)" subtitle={status}>
      <div className="space-y-4">
        {result?.message && <p className="text-xs text-emerald-600">{result.message}</p>}
        {(flow.error ?? result?.error) && <p className="text-xs text-[#B4541A]">{flow.error ?? result?.error}</p>}
        {result?.recoveryCodes && <RecoveryCodes codes={result.recoveryCodes} />}

        {!state.enabled && !state.setup && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-[16px] border border-line bg-paper p-5 space-y-3">
              <div className="flex items-center gap-2 text-ink">
                <FaMobileScreen aria-hidden="true" />
                <p className="text-sm font-semibold">แอป Authenticator</p>
              </div>
              <p className="text-xs text-muted-ink">
                ใช้แอป Google Authenticator, Microsoft Authenticator หรือ 1Password สร้างรหัส 6 หลักตอนเข้าสู่ระบบ
              </p>
              <Form method="post">
                <input type="hidden" name="intent" value="2fa_start" />
                <button type="submit" disabled={busy} className={pillPrimary}>
                  ตั้งค่าด้วยแอป
                </button>
              </Form>
            </div>
            <div className="rounded-[16px] border border-line bg-paper p-5 space-y-3">
              <div className="flex items-center gap-2 text-ink">
                <FaKey aria-hidden="true" />
                <p className="text-sm font-semibold">
                  Passkey (Face ID / Touch ID / Windows Hello / กุญแจความปลอดภัย)
                </p>
              </div>
              {webauthn === false ? (
                <p className="text-xs text-muted-ink">
                  เบราว์เซอร์นี้ไม่รองรับ passkey — ใช้แอป Authenticator หรือเปิดหน้านี้ในเบราว์เซอร์รุ่นใหม่
                </p>
              ) : (
                <>
                  <p className="text-xs text-muted-ink">ยืนยันด้วยลายนิ้วมือ ใบหน้า หรือกุญแจความปลอดภัยของอุปกรณ์</p>
                  <PasskeyNameForm label="ตั้งค่าด้วย passkey" flow={flow} />
                </>
              )}
            </div>
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

        {state.method === "passkey" && (
          <div className="space-y-4">
            <ul className="divide-y divide-line-soft rounded-[14px] border border-line">
              {state.passkeys.map((pk) => (
                <li key={pk.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div>
                    <p className="text-sm font-semibold text-ink">{pk.name || "Passkey"}</p>
                    <p className="text-xs text-muted-ink">
                      เพิ่มเมื่อ {formatDate(pk.createdAt, "th")} · ใช้ล่าสุด{" "}
                      {pk.lastUsedAt ? formatDate(pk.lastUsedAt, "th") : "ยังไม่เคยใช้"}
                    </p>
                  </div>
                  <Form method="post">
                    <input type="hidden" name="intent" value="pk_remove" />
                    <input type="hidden" name="passkey_id" value={pk.id} />
                    <ConfirmButton
                      className={pillOutline}
                      disabled={busy || onlyOne}
                      title={onlyOne ? "ลบ passkey สุดท้ายไม่ได้ — ใช้ปิด 2FA / เปลี่ยนวิธีแทน" : undefined}
                      destructive
                      confirmLabel="ลบ passkey"
                      message={`ลบ “${pk.name || "Passkey"}” — อุปกรณ์นี้จะใช้ยืนยันตัวตนไม่ได้อีก`}
                    >
                      ลบ
                    </ConfirmButton>
                  </Form>
                </li>
              ))}
            </ul>
            {webauthn !== false && <PasskeyNameForm label="เพิ่ม passkey" flow={flow} />}
            <div className="flex flex-wrap gap-2">
              <Form
                method="post"
                onSubmit={(e) => {
                  e.preventDefault();
                  flow.authThen("2fa_regen");
                }}
              >
                <ConfirmButton
                  className={pillOutline}
                  disabled={busy || flow.busy}
                  confirmLabel="สร้าง recovery codes ใหม่"
                  message="ยืนยันด้วย passkey — recovery codes ชุดเดิมทั้งหมดจะใช้ไม่ได้อีก"
                >
                  สร้าง recovery codes ใหม่
                </ConfirmButton>
              </Form>
              <Form
                method="post"
                onSubmit={(e) => {
                  e.preventDefault();
                  flow.authThen("2fa_disable");
                }}
              >
                <ConfirmButton
                  className={pillOutline}
                  disabled={busy || flow.busy}
                  destructive
                  confirmLabel="ปิด 2FA / เปลี่ยนวิธี"
                  message="ยืนยันด้วย passkey — passkey และ recovery codes ทั้งหมดจะถูกลบ จากนั้นเลือกวิธีใหม่ได้"
                >
                  ปิด 2FA / เปลี่ยนวิธี
                </ConfirmButton>
              </Form>
            </div>
            <RecoveryDisableForm busy={busy} />
          </div>
        )}

        {state.method === "totp" && (
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
                confirmLabel="ปิด 2FA / เปลี่ยนวิธี"
                message="ปิด 2FA แล้วเลือกวิธีใหม่ได้ (ทีมงานต้องเปิด 2FA ใหม่ก่อนใช้งาน portal)"
              >
                ปิด 2FA / เปลี่ยนวิธี
              </ConfirmButton>
            </Form>
            <RecoveryDisableForm busy={busy} />
          </div>
        )}
      </div>
    </SectionCard>
  );
}
