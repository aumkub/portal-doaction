import { useContext, useEffect, useRef, useState } from "react";
import {
  UNSAFE_DataRouterStateContext,
  useFetchers,
  useNavigation,
  type Fetcher,
} from "react-router";
import { useT } from "~/lib/i18n";

/**
 * Posts that are not "saving something": signing in/out, switching views,
 * background polling and uploads. They get no toast.
 */
const IGNORED_ACTIONS = [
  /^\/login/,
  /^\/logout/,
  /^\/magic-link/,
  /^\/api\/send-magic-link/,
  /^\/api\/impersonation/,
  /^\/api\/language/,
  /^\/api\/notifications/,
  /^\/api\/attachments-upload/,
];

type Toast = { id: number; kind: "ok" | "error"; label: string };

/** Action results signal a validation failure with `errors`, `error` or `ok: false`. */
function failed(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  return Boolean(d.errors) || Boolean(d.error) || d.ok === false;
}

function ignored(action: string | undefined): boolean {
  if (!action) return false;
  const path = action.split("?")[0];
  return IGNORED_ACTIONS.some((re) => re.test(path));
}

/**
 * App-wide "saved" popup. Watches every form submission and fetcher; when a
 * POST finishes it shows a short animated confirmation, or an error popup if
 * the action returned validation errors. Pages need no code of their own.
 */
export function SaveToast() {
  const { lang } = useT();
  const navigation = useNavigation();
  const fetchers = useFetchers();
  // Route action results live in the router state, keyed by route id.
  const routerState = useContext(UNSAFE_DataRouterStateContext);
  const [toast, setToast] = useState<Toast | null>(null);
  const seq = useRef(0);

  const labels = {
    ok: lang === "en" ? "Saved" : "บันทึกแล้ว",
    sent: lang === "en" ? "Sent" : "ส่งแล้ว",
    error: lang === "en" ? "Couldn't save — check the form" : "บันทึกไม่สำเร็จ ตรวจสอบข้อมูลอีกครั้ง",
  };

  function show(kind: Toast["kind"], intent: FormDataEntryValue | null | undefined) {
    const label = kind === "error" ? labels.error : intent === "reply" ? labels.sent : labels.ok;
    setToast({ id: ++seq.current, kind, label });
  }

  // Form submissions that navigate (most pages).
  const lastNav = useRef<{ action?: string; intent?: FormDataEntryValue | null } | null>(null);
  useEffect(() => {
    if (navigation.state === "submitting" && navigation.formMethod?.toUpperCase() === "POST") {
      lastNav.current = { action: navigation.formAction, intent: navigation.formData?.get("intent") };
      return;
    }
    if (navigation.state === "idle" && lastNav.current) {
      const { action, intent } = lastNav.current;
      lastNav.current = null;
      if (ignored(action)) return;
      const results = Object.values(routerState?.actionData ?? {});
      show(results.some(failed) ? "error" : "ok", intent);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation.state]);

  // Fetcher submissions (inline toggles such as the monthly care mark).
  // useFetchers() lists only in-flight fetchers, so a fetcher that was
  // submitting and has now dropped out of the list (or gone idle) is done.
  const pendingFetchers = useRef(new Map<string, { action?: string; intent?: FormDataEntryValue | null }>());
  useEffect(() => {
    const live = new Map<string, Fetcher>();
    for (const f of fetchers as (Fetcher & { key: string })[]) live.set(f.key, f);
    for (const [key, f] of live) {
      if (f.state === "submitting" && f.formMethod?.toUpperCase() === "POST" && !pendingFetchers.current.has(key)) {
        pendingFetchers.current.set(key, { action: f.formAction, intent: f.formData?.get("intent") });
      }
    }
    for (const [key, tracked] of pendingFetchers.current) {
      const f = live.get(key);
      if (f && f.state !== "idle") continue;
      pendingFetchers.current.delete(key);
      if (!ignored(tracked.action)) show(f && failed(f.data) ? "error" : "ok", tracked.intent);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchers]);

  useEffect(() => {
    if (!toast) return;
    const id = toast.id;
    const timer = setTimeout(() => setToast((t) => (t?.id === id ? null : t)), toast.kind === "error" ? 3200 : 1800);
    return () => clearTimeout(timer);
  }, [toast]);

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-24 z-[90] flex justify-center px-4 md:bottom-8"
    >
      {toast && (
        <div
          key={toast.id}
          role="status"
          className={`save-toast flex items-center gap-2.5 rounded-full py-2.5 pl-2.5 pr-5 text-sm font-semibold shadow-[0_12px_32px_rgba(0,0,0,0.18)] ${
            toast.kind === "ok" ? "bg-ink text-white" : "bg-[#B4541A] text-white"
          }`}
        >
          <span
            className={`flex h-7 w-7 items-center justify-center rounded-full ${
              toast.kind === "ok" ? "bg-brand-yellow text-ink" : "bg-white/20 text-white"
            }`}
          >
            {toast.kind === "ok" ? (
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path className="save-toast-check" d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
                <path d="M12 7v6M12 17h.01" />
              </svg>
            )}
          </span>
          {toast.label}
        </div>
      )}
    </div>
  );
}
