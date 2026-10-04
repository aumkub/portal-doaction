export interface BubbleAttachment {
  id: string;
  name: string;
  href: string;
  icon?: string;
}

export default function MessageBubble({
  message,
  isClient,
  isInternal,
  authorName,
  attachments = [],
  alignRight,
  onAttachmentClick,
  internalLabel,
}: {
  message: string;
  isClient: boolean;
  isInternal: boolean;
  authorName?: string;
  attachments?: BubbleAttachment[];
  alignRight?: boolean;
  onAttachmentClick?: (attachment: BubbleAttachment) => void;
  internalLabel?: string;
}) {
  const shouldAlignRight = alignRight ?? isClient;

  const bubbleClass = isInternal
    ? "bg-[#FFF8CC] text-[#3A3000] border border-dashed border-[#E3CF5C]"
    : isClient
    ? "bg-paper text-ink"
    : "bg-ink text-white";

  const attachmentClass = isInternal
    ? "border-[#E3CF5C] bg-white text-[#3A3000] hover:bg-[#FFF8CC]"
    : isClient
    ? "border-line bg-white text-ink-soft hover:bg-white/70"
    : "border-white/30 bg-white/10 text-white hover:bg-white/20";

  return (
    <div className={`flex ${shouldAlignRight ? "justify-end" : "justify-start"}`}>
      <div className={`min-w-0 max-w-[85%] md:max-w-[72%] rounded-2xl px-4 py-3 text-sm leading-[1.65] [overflow-wrap:anywhere] ${bubbleClass}`}>
        {isInternal && (
          <p className="mb-1.5 text-[11px] font-bold tracking-[0.06em] text-[#8A6D00]">
            {internalLabel ?? "โน้ตภายใน · ลูกค้าไม่เห็น"}
          </p>
        )}
        {authorName ? (
          <p className="mb-1 text-xs font-medium opacity-80">{authorName}</p>
        ) : null}
        <p className="whitespace-pre-wrap">{message}</p>
        {attachments.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {attachments.map((a) => {
              const isImage = a.icon === "🖼️";
              return isImage ? (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => onAttachmentClick?.(a)}
                  className="block max-w-full rounded-lg overflow-hidden border border-white/20 hover:opacity-90 transition-opacity focus:outline-none focus:ring-2 focus:ring-slate-400"
                >
                  <img
                    src={a.href}
                    alt={a.name}
                    className="block max-h-40 w-auto max-w-full object-cover sm:max-w-[240px]"
                  />
                </button>
              ) : (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => onAttachmentClick ? onAttachmentClick(a) : window.open(a.href, "_blank")}
                  className={`inline-flex items-center rounded-md border px-2.5 py-1 text-xs transition-colors ${attachmentClass}`}
                >
                  {a.icon ? `${a.icon} ` : "📎 "}
                  {a.name}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}
