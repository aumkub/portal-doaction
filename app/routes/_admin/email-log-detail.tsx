import { useState } from "react";
import type { Route } from "./+types/email-log-detail";
import { requireAdmin } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";
import { MAIL_FROM } from "~/lib/email.server";
import { parseClientCcEmails } from "~/lib/client-cc";
import { formatDate } from "~/lib/utils";
import { useT } from "~/lib/i18n";
import {
  FaArrowLeft,
  FaArrowUpRightFromSquare,
  FaCode,
  FaCopy,
  FaDesktop,
  FaEye,
  FaFileLines,
  FaMobileScreen,
} from "react-icons/fa6";

export function meta({ data }: Route.MetaArgs) {
  return [{ title: `${data?.log.subject ?? "Email"} — Email Logs` }];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  await requireAdmin(request, env.DB, env.SESSIONPORTAL);
  const log = await createDB(env.DB).getEmailLog(params.logId);
  if (!log) throw new Response("Not found", { status: 404 });
  return { log, from: MAIL_FROM };
}

type Tab = "preview" | "text" | "html";

function timeLabel(unix: number): string {
  return new Date((unix + 7 * 3600) * 1000).toISOString().slice(11, 16);
}

export default function EmailLogDetailPage({ loaderData }: Route.ComponentProps) {
  const { log, from } = loaderData;
  const { lang } = useT();
  const L = (th: string, en: string) => (lang === "en" ? en : th);
  const [tab, setTab] = useState<Tab>("preview");
  const [width, setWidth] = useState<"desktop" | "mobile">("desktop");
  const [copied, setCopied] = useState(false);

  const cc = parseClientCcEmails(log.cc_emails);
  const failed = log.status === "failed";

  function copyHtml() {
    navigator.clipboard?.writeText(log.html_body).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  const tabs: { id: Tab; label: string; icon: typeof FaEye }[] = [
    { id: "preview", label: L("ตัวอย่างที่ผู้รับเห็น", "As received"), icon: FaEye },
    { id: "text", label: L("ข้อความล้วน", "Plain text"), icon: FaFileLines },
    { id: "html", label: "HTML", icon: FaCode },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <a href="/admin/email-logs" className="inline-flex items-center gap-1.5 text-[13px] text-muted-ink hover:text-ink">
        <FaArrowLeft className="text-[11px]" aria-hidden="true" />
        {L("กลับไปอีเมลล็อก", "Back to email logs")}
      </a>

      {/* Envelope: what an email client shows above the message */}
      <section className="rounded-[20px] border border-line bg-white p-5 md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="min-w-0 text-[22px] md:text-[26px] font-bold tracking-[-0.02em] text-ink [overflow-wrap:anywhere]">
            {log.subject}
          </h1>
          <span
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${
              failed ? "bg-[#FDE7DA] text-[#B4541A]" : "bg-emerald-50 text-emerald-700"
            }`}
          >
            {failed ? L("ส่งไม่สำเร็จ", "Failed") : L("ส่งแล้ว", "Sent")}
          </span>
        </div>
        <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
          <dt className="text-muted-ink">{L("จาก", "From")}</dt>
          <dd className="text-ink [overflow-wrap:anywhere]">do action &lt;{from}&gt;</dd>
          <dt className="text-muted-ink">{L("ถึง", "To")}</dt>
          <dd className="text-ink [overflow-wrap:anywhere]">
            {log.to_name ? `${log.to_name} <${log.to_email}>` : log.to_email}
          </dd>
          {cc.length > 0 && (
            <>
              <dt className="text-muted-ink">CC</dt>
              <dd className="text-ink [overflow-wrap:anywhere]">{cc.join(", ")}</dd>
            </>
          )}
          <dt className="text-muted-ink">{L("วันที่", "Date")}</dt>
          <dd className="text-ink">
            {formatDate(log.created_at, lang)} {timeLabel(log.created_at)}
          </dd>
          {log.source && (
            <>
              <dt className="text-muted-ink">{L("ที่มา", "Source")}</dt>
              <dd className="font-mono text-xs text-ink-soft">{log.source}</dd>
            </>
          )}
        </dl>
        {log.error_message && (
          <p className="mt-4 rounded-[12px] bg-[#FDE7DA] px-4 py-3 text-sm text-[#B4541A] [overflow-wrap:anywhere]">
            {log.error_message}
          </p>
        )}
      </section>

      {/* Body */}
      <section className="overflow-hidden rounded-[20px] border border-line bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-soft px-4 py-3">
          <div className="inline-flex max-w-full overflow-x-auto rounded-full bg-paper p-[3px]" role="tablist">
            {tabs.map((tb) => (
              <button
                key={tb.id}
                type="button"
                role="tab"
                aria-selected={tab === tb.id}
                onClick={() => setTab(tb.id)}
                className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium ${
                  tab === tb.id ? "bg-white text-ink shadow-[0_1px_2px_rgba(0,0,0,0.08)]" : "text-muted-ink hover:text-ink"
                }`}
              >
                <tb.icon className="text-[11px]" aria-hidden="true" />
                {tb.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            {tab === "preview" && (
              <div className="inline-flex rounded-full bg-paper p-[3px]">
                {(["desktop", "mobile"] as const).map((w) => (
                  <button
                    key={w}
                    type="button"
                    onClick={() => setWidth(w)}
                    aria-pressed={width === w}
                    aria-label={w === "desktop" ? L("มุมมองคอมพิวเตอร์", "Desktop") : L("มุมมองมือถือ", "Mobile")}
                    className={`flex h-8 w-9 items-center justify-center rounded-full ${
                      width === w ? "bg-white text-ink shadow-[0_1px_2px_rgba(0,0,0,0.08)]" : "text-muted-ink hover:text-ink"
                    }`}
                  >
                    {w === "desktop" ? <FaDesktop className="text-xs" /> : <FaMobileScreen className="text-xs" />}
                  </button>
                ))}
              </div>
            )}
            {tab === "html" && (
              <button
                type="button"
                onClick={copyHtml}
                className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line bg-white px-3 text-xs font-semibold text-ink-soft hover:bg-paper"
              >
                <FaCopy className="text-[10px]" aria-hidden="true" />
                {copied ? L("คัดลอกแล้ว", "Copied") : L("คัดลอก", "Copy")}
              </button>
            )}
            <a
              href={`/api/admin/email-logs/${log.id}/raw`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line bg-white px-3 text-xs font-semibold text-ink-soft hover:bg-paper"
            >
              <FaArrowUpRightFromSquare className="text-[10px]" aria-hidden="true" />
              {L("เปิดแท็บใหม่", "Open in new tab")}
            </a>
          </div>
        </div>

        {tab === "preview" && (
          <div className="bg-paper p-3 sm:p-6">
            <iframe
              title={L("ตัวอย่างอีเมล", "Email preview")}
              // Stored HTML is untrusted: no scripts, no same-origin access.
              sandbox=""
              srcDoc={log.html_body}
              className={`mx-auto block h-[75dvh] rounded-[14px] border border-line bg-white shadow-[0_8px_24px_rgba(0,0,0,0.06)] transition-[width] duration-300 ${
                width === "mobile" ? "w-[375px] max-w-full" : "w-full"
              }`}
            />
          </div>
        )}
        {tab === "text" && (
          <pre className="max-h-[75dvh] overflow-auto whitespace-pre-wrap p-5 font-sans text-sm leading-7 text-ink [overflow-wrap:anywhere]">
            {log.text_body || L("(ไม่มีข้อความล้วน)", "(no plain-text part)")}
          </pre>
        )}
        {tab === "html" && (
          <pre className="max-h-[75dvh] overflow-auto bg-[#111] p-5 font-mono text-xs leading-6 text-[#E6E3DA] [overflow-wrap:anywhere] whitespace-pre-wrap">
            {log.html_body}
          </pre>
        )}
      </section>
    </div>
  );
}
