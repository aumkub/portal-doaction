import { useEffect, useState } from "react";
import { useRevalidator } from "react-router";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { formatDate, formatRelativeTime } from "~/lib/utils";
import { useT } from "~/lib/i18n";
import type { MonthlyReport } from "~/types";

export type ReportRowForEmail = MonthlyReport & {
  company_name: string;
  client_email: string;
  client_contact_name: string;
};

type PreviewPayload = {
  subject: string;
  html: string;
  to: string;
  toName: string;
  cc: string[];
};

interface ReportCustomerEmailDialogProps {
  report: ReportRowForEmail | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "send" | "view";
}

export default function ReportCustomerEmailDialog({
  report,
  open,
  onOpenChange,
  mode,
}: ReportCustomerEmailDialogProps) {
  const { t, lang } = useT();
  const revalidator = useRevalidator();

  const [preview, setPreview] = useState<PreviewPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const notifiedAt = report?.client_notified_at ?? null;
  const storedHtml = report?.client_notification_html ?? null;
  const storedSubject = report?.client_notification_subject ?? null;

  useEffect(() => {
    if (!open || !report) {
      setPreview(null);
      setError(null);
      setLoading(false);
      return;
    }

    if (mode === "view") {
      setPreview(null);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setPreview(null);

    fetch(
      `/api/report-email-preview?reportId=${encodeURIComponent(report.id)}`,
      { credentials: "include" }
    )
      .then(async (res) => {
        const data = (await res.json()) as PreviewPayload & { error?: string };
        if (!res.ok) {
          throw new Error(data.error || "preview_failed");
        }
        return data;
      })
      .then((data) => {
        if (!cancelled) {
          setPreview({
            subject: data.subject,
            html: data.html,
            to: data.to,
            toName: data.toName,
            cc: data.cc,
          });
        }
      })
      .catch(() => {
        if (!cancelled) setError(t("admin_report_email_preview_error"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, mode, report, t]);

  const displaySubject =
    mode === "view" ? storedSubject : preview?.subject;
  const displayHtml = mode === "view" ? storedHtml : preview?.html;
  const displayTo = mode === "view" ? report?.client_email : preview?.to;
  const displayToName =
    mode === "view" ? report?.client_contact_name : preview?.toName;

  const handleSend = async () => {
    if (!report) return;
    setSending(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("reportId", report.id);
      const res = await fetch("/api/report-notify", {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; message?: string };
      if (!res.ok) {
        if (data.error === "email_not_configured") {
          setError(t("admin_report_email_not_configured"));
        } else {
          setError(data.message || data.error || t("admin_report_email_send_error"));
        }
        return;
      }
      revalidator.revalidate();
      onOpenChange(false);
    } catch {
      setError(t("admin_report_email_send_error"));
    } finally {
      setSending(false);
    }
  };

  if (!report) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton
        className="sm:max-w-[640px] max-h-[90vh] flex flex-col gap-0 p-0 overflow-hidden border-slate-200"
      >
        <div className="px-6 pt-6 pb-4 border-b border-slate-100 bg-gradient-to-b from-slate-50/80 to-white">
          <DialogHeader className="space-y-1">
            <DialogTitle className="text-lg text-slate-900">
              {mode === "send"
                ? t("admin_report_email_dialog_send_title")
                : t("admin_report_email_dialog_view_title")}
            </DialogTitle>
            <DialogDescription className="text-slate-500 text-sm">
              {mode === "send"
                ? t("admin_report_email_dialog_send_desc")
                : t("admin_report_email_dialog_view_desc")}
            </DialogDescription>
          </DialogHeader>
          {notifiedAt != null && mode === "view" && (
            <p className="text-xs text-emerald-700 font-medium mt-3 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              {t("admin_report_email_sent_at")}{" "}
              {lang === "en"
                ? formatRelativeTime(notifiedAt, "en")
                : formatRelativeTime(notifiedAt, "th")}
              <span className="text-emerald-600/80 font-normal">
                ({formatDate(notifiedAt, lang)})
              </span>
            </p>
          )}
        </div>

        <div className="px-6 py-4 space-y-3 flex-1 min-h-0 flex flex-col">
          {(displayTo || displaySubject) && (
            <div className="rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3 text-sm space-y-2 shrink-0">
              {displayTo && (
                <div className="flex flex-col sm:flex-row sm:items-baseline gap-0.5 sm:gap-3">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-400 w-20 shrink-0">
                    {t("admin_report_email_to")}
                  </span>
                  <span className="text-slate-800">
                    {displayToName ? `${displayToName} ` : null}
                    <span className="text-slate-600">&lt;{displayTo}&gt;</span>
                  </span>
                </div>
              )}
              {preview?.cc && preview.cc.length > 0 && (
                <div className="flex flex-col sm:flex-row sm:items-baseline gap-0.5 sm:gap-3">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-400 w-20 shrink-0">
                    CC
                  </span>
                  <span className="text-slate-800">
                    {preview.cc.join(", ")}
                  </span>
                </div>
              )}
              {displaySubject && (
                <div className="flex flex-col sm:flex-row sm:items-baseline gap-0.5 sm:gap-3">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-400 w-20 shrink-0">
                    {t("admin_report_email_subject")}
                  </span>
                  <span className="text-slate-800 font-medium leading-snug">{displaySubject}</span>
                </div>
              )}
            </div>
          )}

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          {mode === "send" && loading && (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400 text-sm gap-3">
              <div className="w-8 h-8 border-2 border-slate-200 border-t-violet-600 rounded-full animate-spin" />
              {t("admin_report_email_loading_preview")}
            </div>
          )}

          {mode === "view" && !storedHtml && (
            <p className="text-sm text-slate-500 py-8 text-center">
              {t("admin_report_email_no_stored")}
            </p>
          )}

          {displayHtml && !(mode === "send" && loading) && (
            <div className="flex-1 min-h-[280px] flex flex-col rounded-xl border border-slate-200 overflow-hidden bg-white shadow-inner">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 px-3 py-2 bg-slate-50 border-b border-slate-100">
                {t("admin_report_email_preview_label")}
              </p>
              <iframe
                title={t("admin_report_email_preview_label")}
                srcDoc={displayHtml}
                sandbox="allow-popups allow-top-navigation-by-user-activation"
                className="w-full flex-1 min-h-[260px] border-0 bg-white"
              />
            </div>
          )}
        </div>

        <DialogFooter className="px-6 py-4 border-t border-slate-100 bg-slate-50/50 sm:justify-between gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("admin_report_email_close")}
          </Button>
          {mode === "send" && (
            <Button
              type="button"
              disabled={loading || !preview || sending}
              onClick={handleSend}
              className="bg-violet-600 hover:bg-violet-700 text-white"
            >
              {sending ? t("admin_report_email_sending") : t("admin_report_email_confirm_send")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
