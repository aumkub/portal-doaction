import type { ReactNode } from "react";

type Attachment = {
  id: string;
  name: string;
  href: string;
  icon?: string;
  mimeType?: string;
};

function isImage({ mimeType, name }: Attachment): boolean {
  if (mimeType) return mimeType.startsWith("image/");
  return /\.(png|jpe?g|gif|webp|avif)$/i.test(name);
}

export default function MessageBubble({
  message,
  isClient,
  isInternal,
  authorName,
  authorBadge,
  attachments = [],
  alignRight,
  pending,
  actions,
}: {
  message: string;
  isClient: boolean;
  isInternal: boolean;
  authorName?: string;
  authorBadge?: string;
  attachments?: Attachment[];
  alignRight?: boolean;
  /** Not yet confirmed by the server. */
  pending?: boolean;
  /** Rendered beside the author line, e.g. a delete control. */
  actions?: ReactNode;
}) {
  const shouldAlignRight = alignRight ?? isClient;

  const bubbleClass = isInternal
    ? "bg-amber-50 text-amber-900 border border-amber-300"
    : isClient
    ? "bg-white text-slate-800 border border-slate-200"
    : "bg-violet-600 text-white";

  const attachmentClass = isInternal
    ? "border-amber-300 bg-white text-amber-800 hover:bg-amber-50"
    : isClient
    ? "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
    : "border-white/30 bg-white/10 text-white hover:bg-white/20";

  const thumbnailClass = isInternal
    ? "border-amber-300 hover:border-amber-500"
    : isClient
    ? "border-slate-200 hover:border-slate-400"
    : "border-white/30 hover:border-white/70";

  return (
    <div className={`flex ${shouldAlignRight ? "justify-end" : "justify-start"}`}>
      <div
        className={`group max-w-[80%] rounded-2xl px-4 py-3 text-sm shadow-sm transition-opacity ${bubbleClass} ${
          pending ? "opacity-60" : ""
        }`}
        aria-busy={pending || undefined}
      >
        {isInternal && (
          <div className="flex items-center gap-1.5 mb-2 pb-2 border-b border-amber-200">
            <span className="text-[11px]">🔒</span>
            <span className="text-[11px] font-semibold text-amber-700 uppercase tracking-wide">
              บันทึกภายใน
            </span>
          </div>
        )}
        {authorName || actions ? (
          <div className="mb-1 flex items-center justify-between gap-3">
            <p className="text-xs font-medium opacity-80">
              {authorName}
              {authorBadge ? (
                <span className="ml-1.5 rounded bg-black/10 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide">
                  {authorBadge}
                </span>
              ) : null}
            </p>
            {actions}
          </div>
        ) : null}
        <p className="whitespace-pre-wrap">{message}</p>
        {attachments.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {attachments.map((a) =>
              // A pending file is not linked to a message yet, so its URL 404s.
              isImage(a) && !pending ? (
                <a
                  key={a.id}
                  href={a.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={a.name}
                  className={`block overflow-hidden rounded-lg border transition-colors ${thumbnailClass}`}
                >
                  <img
                    src={a.href}
                    alt={a.name}
                    loading="lazy"
                    decoding="async"
                    className="h-24 w-24 object-cover"
                  />
                </a>
              ) : (
                <a
                  key={a.id}
                  href={a.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`inline-flex items-center rounded-md border px-2.5 py-1 text-xs transition-colors ${attachmentClass}`}
                >
                  {a.icon ? `${a.icon} ` : "📎 "}
                  {a.name}
                </a>
              )
            )}
          </div>
        ) : null}
        {pending ? (
          <p className="mt-1.5 text-[11px] opacity-70">กำลังส่ง…</p>
        ) : null}
      </div>
    </div>
  );
}
