import { FaPaperclip, FaFilePdf, FaPlay, FaXmark, FaImage, FaVideo } from "react-icons/fa6";
import { useState, useEffect, useCallback } from "react";

type Attachment = {
  id: string;
  name: string;
  href: string;
  mimeType?: string;
  sizeBytes?: number;
};

function fmtSize(bytes?: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function PreviewModal({ att, onClose }: { att: Attachment; onClose: () => void }) {
  const mime = att.mimeType ?? "";
  const isImage = mime.startsWith("image/");
  const isVideo = mime.startsWith("video/");
  const isPdf = mime === "application/pdf";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-4xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute -top-10 right-0 flex h-8 w-8 items-center justify-center rounded-full bg-white/20 text-white hover:bg-white/30 transition-colors"
          aria-label="Close preview"
        >
          <FaXmark className="text-sm" />
        </button>
        <p className="absolute -top-10 left-0 max-w-[70%] truncate text-sm text-white/80">
          {att.name}
        </p>
        {isImage && (
          <img
            src={att.href}
            alt={att.name}
            className="mx-auto max-h-[85vh] max-w-full rounded-xl object-contain shadow-2xl"
          />
        )}
        {isVideo && (
          <video
            src={att.href}
            controls
            autoPlay
            className="mx-auto max-h-[85vh] max-w-full rounded-xl shadow-2xl"
          />
        )}
        {isPdf && (
          <iframe
            src={att.href}
            title={att.name}
            className="h-[85vh] w-full rounded-xl bg-white shadow-2xl"
          />
        )}
        {!isImage && !isVideo && !isPdf && (
          <div className="flex flex-col items-center gap-4 rounded-xl bg-white p-8 shadow-2xl">
            <FaPaperclip className="text-4xl text-slate-400" />
            <p className="text-slate-700">{att.name}</p>
            <a
              href={att.href}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700"
            >
              Download
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

function AttachmentItem({
  att,
  isClient,
}: {
  att: Attachment;
  isClient: boolean;
}) {
  const [preview, setPreview] = useState(false);
  const mime = att.mimeType ?? "";
  const isImage = mime.startsWith("image/");
  const isVideo = mime.startsWith("video/");
  const isPdf = mime === "application/pdf";
  const isPreviewable = isImage || isVideo || isPdf;

  const open = useCallback(() => setPreview(true), []);
  const close = useCallback(() => setPreview(false), []);

  if (isImage) {
    return (
      <>
        <button
          type="button"
          onClick={open}
          className="group flex w-20 cursor-pointer flex-col items-center gap-1"
          title={att.name}
        >
          <div className="relative overflow-hidden rounded-lg border border-black/10 transition-transform group-hover:scale-105 group-active:scale-95">
            <img
              src={att.href}
              alt={att.name}
              className="h-20 w-20 object-cover"
            />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
          </div>
          <span className="flex w-full items-center justify-center gap-1">
            <FaImage className="shrink-0 text-[11px] opacity-50" />
            <span className="text-[11px] opacity-70">{fmtSize(att.sizeBytes)}</span>
          </span>
        </button>
        {preview && <PreviewModal att={att} onClose={close} />}
      </>
    );
  }

  if (isVideo) {
    return (
      <>
        <button
          type="button"
          onClick={open}
          className="group flex w-20 cursor-pointer flex-col items-center gap-1"
          title={att.name}
        >
          <div className="relative h-20 w-20 overflow-hidden rounded-lg border border-black/10 shadow-sm transition-transform group-hover:scale-105 group-active:scale-95">
            <video
              src={att.href}
              preload="metadata"
              muted
              playsInline
              className="h-full w-full object-cover"
              onLoadedMetadata={(e) => { (e.currentTarget as HTMLVideoElement).currentTime = 0.1; }}
            />
            <div className="absolute inset-0 flex items-center justify-center bg-black/30">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-black/50 backdrop-blur-sm">
                <FaPlay className="text-xs text-white" />
              </div>
            </div>
          </div>
          <span className="flex w-full items-center justify-center gap-1">
            <FaVideo className="shrink-0 text-[11px] opacity-50" />
            <span className="text-[11px] opacity-70">{fmtSize(att.sizeBytes)}</span>
          </span>
        </button>
        {preview && <PreviewModal att={att} onClose={close} />}
      </>
    );
  }

  if (isPdf) {
    return (
      <>
        <button
          type="button"
          onClick={open}
          className="group flex w-20 cursor-pointer flex-col items-center gap-1"
          title={att.name}
        >
          <div className="flex h-20 w-20 flex-col items-center justify-center rounded-lg border border-rose-200 bg-rose-50 shadow-sm transition-transform group-hover:scale-105 group-active:scale-95">
            <FaFilePdf className="text-2xl text-rose-500" />
          </div>
          <span className="flex w-full items-center justify-center gap-1">
            <FaFilePdf className="shrink-0 text-[9px] text-rose-400" />
            <span className="text-[11px] opacity-70">{fmtSize(att.sizeBytes)}</span>
          </span>
        </button>
        {preview && <PreviewModal att={att} onClose={close} />}
      </>
    );
  }

  const linkClass = isClient
    ? "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
    : "border-white/30 bg-white/10 text-white hover:bg-white/20";

  return (
    <a
      href={att.href}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center rounded-md border px-2.5 py-1 text-xs transition-colors ${linkClass}`}
    >
      <FaPaperclip className="mr-1" aria-hidden="true" />
      {att.name}
    </a>
  );
}

export default function MessageBubble({
  message,
  isClient,
  isInternal,
  authorName,
  attachments = [],
  alignRight,
}: {
  message: string;
  isClient: boolean;
  isInternal: boolean;
  authorName?: string;
  attachments?: Attachment[];
  alignRight?: boolean;
}) {
  const shouldAlignRight = alignRight ?? isClient;

  const thumbnailAttachments = attachments.filter((a) => {
    const m = a.mimeType ?? "";
    return m.startsWith("image/") || m.startsWith("video/") || m === "application/pdf";
  });
  const linkAttachments = attachments.filter((a) => {
    const m = a.mimeType ?? "";
    return !m.startsWith("image/") && !m.startsWith("video/") && m !== "application/pdf";
  });

  return (
    <div className={`flex ${shouldAlignRight ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm shadow-sm ${
          isClient
            ? "bg-white text-slate-800 border border-slate-200"
            : "bg-violet-600 text-white"
        }`}
      >
        {authorName ? (
          <p className="mb-1 text-xs font-medium opacity-80">{authorName}</p>
        ) : null}
        <p className="whitespace-pre-wrap">{message}</p>
        {thumbnailAttachments.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {thumbnailAttachments.map((a) => (
              <AttachmentItem key={a.id} att={a} isClient={isClient} />
            ))}
          </div>
        ) : null}
        {linkAttachments.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {linkAttachments.map((a) => (
              <AttachmentItem key={a.id} att={a} isClient={isClient} />
            ))}
          </div>
        ) : null}
        {isInternal ? (
          <p className="mt-2 text-[11px] uppercase tracking-wide opacity-75">
            บันทึกภายใน
          </p>
        ) : null}
      </div>
    </div>
  );
}
