import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useFetcher } from "react-router";
import { FaPaperclip } from "react-icons/fa6";
import {
  useTicketAttachments,
  type UploadedAttachment,
} from "~/hooks/use-ticket-attachments";
import { TicketReplyDropZone } from "~/components/tickets/TicketReplyDropZone";

type ReplyResult = { ok?: boolean; errors?: { message?: string[] } };

export function replyFetcherKey(ticketId: string) {
  return `ticket-reply-${ticketId}`;
}

/** Attachments an in-flight reply carries, for rendering the optimistic bubble. */
export function pendingReplyAttachments(formData: FormData | undefined) {
  const raw = formData?.get("attachments_json");
  if (typeof raw !== "string" || !raw) return [];
  try {
    return (JSON.parse(raw) as UploadedAttachment[]).map((f) => ({
      id: f.fileKey,
      name: f.fileName,
      href: f.url,
      mimeType: f.mimeType,
    }));
  } catch {
    return [];
  }
}

export function TicketReplyComposer({
  ticketId,
  hiddenFields,
  label,
  placeholder,
  attachHint,
  dropLabel,
  sendLabel,
  sendingLabel,
  invalidTypeMessage,
  tooLargeMessage,
  uploadFailedMessage,
  extraControls,
}: {
  ticketId: string;
  hiddenFields?: Record<string, string>;
  label: string;
  placeholder: string;
  attachHint: string;
  dropLabel: string;
  sendLabel: string;
  sendingLabel: string;
  invalidTypeMessage?: string;
  tooLargeMessage?: string;
  uploadFailedMessage?: string;
  /** Extra form fields rendered next to the send button. */
  extraControls?: ReactNode;
}) {
  const fetcher = useFetcher<ReplyResult>({ key: replyFetcherKey(ticketId) });
  const [text, setText] = useState("");
  const {
    uploading,
    uploadProgress,
    uploadError,
    uploadedFiles,
    onFileInputChange,
    removeFile,
    takeFiles,
    restoreFiles,
    isDragging,
    dropZoneProps,
  } = useTicketAttachments({
    ticketId,
    invalidTypeMessage,
    tooLargeMessage,
    uploadFailedMessage,
  });

  // Guards against a second click landing before the disabled state renders.
  const inFlightRef = useRef<{ text: string; files: UploadedAttachment[] } | null>(null);
  const sawBusyRef = useRef(false);
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state !== "idle") {
      sawBusyRef.current = true;
      return;
    }
    if (!sawBusyRef.current || !inFlightRef.current) return;
    const sent = inFlightRef.current;
    inFlightRef.current = null;
    sawBusyRef.current = false;
    if (fetcher.data?.errors) {
      setText(sent.text);
      restoreFiles(sent.files);
    }
  }, [fetcher.state, fetcher.data, restoreFiles]);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy || uploading || inFlightRef.current || !text.trim()) return;

    const formData = new FormData(e.currentTarget);
    const files = takeFiles();
    formData.set("message", text);
    formData.set("attachments_json", JSON.stringify(files));
    inFlightRef.current = { text, files };
    fetcher.submit(formData, { method: "post" });
    setText("");
  }

  const serverError = !busy ? fetcher.data?.errors?.message?.[0] : undefined;

  return (
    <TicketReplyDropZone
      isDragging={isDragging}
      dropHandlers={dropZoneProps}
      dropLabel={dropLabel}
      className={isDragging ? "ring-2 ring-ink/20 ring-offset-2 rounded-xl" : ""}
    >
      <form method="post" onSubmit={onSubmit} className="space-y-3">
        {Object.entries(hiddenFields ?? {}).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <label className="block text-sm font-medium text-ink-soft">{label}</label>
        <textarea
          name="message"
          rows={4}
          required
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder}
          className="w-full rounded-[14px] border border-line bg-white px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ink/10 focus:border-ink/40"
        />
        {serverError ? <p className="text-xs text-rose-600">{serverError}</p> : null}
        <div className="space-y-1">
          <label className="block text-xs font-medium text-muted-ink">{attachHint}</label>
          <input
            type="file"
            accept="application/pdf,image/*,video/*"
            multiple
            onChange={(e) => {
              onFileInputChange(e.target.files);
              e.target.value = "";
            }}
            className="block w-full text-xs text-muted-ink file:mr-3 file:rounded-md file:border file:border-line file:bg-white file:px-2.5 file:py-2 mt-2"
          />
          {uploading ? (
            <div className="space-y-2 mt-2">
              <p className="text-xs text-muted-ink">Uploading... {uploadProgress}%</p>
              <div className="h-1.5 w-full rounded bg-line overflow-hidden">
                <div
                  className="h-full bg-ink transition-all"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </div>
          ) : null}
          {uploadError ? <p className="text-xs text-rose-600">{uploadError}</p> : null}
          {uploadedFiles.length > 0 ? (
            <ul className="text-xs text-muted-ink space-y-2 mt-2 max-w-[500px] bg-paper rounded-lg p-2">
              {uploadedFiles.map((f) => (
                <li
                  key={f.fileKey}
                  className="flex items-center justify-between gap-2 bg-paper rounded px-2 py-1"
                >
                  <span>
                    <FaPaperclip className="inline mr-1" aria-hidden="true" />
                    {f.fileName}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeFile(f.fileKey)}
                    className="rounded-md border border-line bg-white px-2 py-0.5 text-[11px] text-muted-ink hover:bg-paper"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <div className="flex items-center justify-between gap-3">
          <div>{extraControls}</div>
          <button
            type="submit"
            disabled={busy || uploading}
            className="inline-flex h-9 items-center rounded-full bg-ink px-3.5 text-[13px] font-medium text-white hover:bg-black transition-colors disabled:cursor-not-allowed disabled:opacity-60"
          >
            {uploading ? "Uploading..." : busy ? sendingLabel : sendLabel}
          </button>
        </div>
      </form>
    </TicketReplyDropZone>
  );
}
