import { FaReply } from "react-icons/fa6";
import { AttachmentIcon } from "./AttachmentIcon";

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
  quote,
  onReply,
  replyLabel = "ตอบกลับ",
}: {
  message: string;
  isClient: boolean;
  isInternal: boolean;
  authorName?: string;
  attachments?: BubbleAttachment[];
  alignRight?: boolean;
  onAttachmentClick?: (attachment: BubbleAttachment) => void;
  internalLabel?: string;
  /** The earlier message this one replies to. */
  quote?: { author: string; text: string; onClick?: () => void };
  /** Shows a reply action under the bubble. */
  onReply?: () => void;
  replyLabel?: string;
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
    <div className={`flex flex-col ${shouldAlignRight ? "items-end" : "items-start"}`}>
      <div className={`min-w-0 max-w-[85%] md:max-w-[72%] rounded-2xl px-4 py-3 text-sm leading-[1.65] [overflow-wrap:anywhere] ${bubbleClass}`}>
        {isInternal && (
          <p className="mb-1.5 text-[11px] font-bold tracking-[0.06em] text-[#8A6D00]">
            {internalLabel ?? "โน้ตภายใน · ลูกค้าไม่เห็น"}
          </p>
        )}
        {authorName ? (
          <p className="mb-1 text-xs font-medium opacity-80">{authorName}</p>
        ) : null}
        {quote ? (
          <button
            type="button"
            onClick={quote.onClick}
            className="mb-2 block w-full rounded-lg border-l-[3px] border-current/40 bg-black/[0.06] px-2.5 py-1.5 text-left text-xs opacity-80 hover:opacity-100"
          >
            <span className="block font-semibold">{quote.author}</span>
            <span className="line-clamp-2 whitespace-pre-wrap">{quote.text}</span>
          </button>
        ) : null}
        <p className="whitespace-pre-wrap">{linkify(message)}</p>
        {attachments.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {attachments.map((a) => {
              const isImage = a.icon === "image";
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
                  <AttachmentIcon kind={a.icon} className="mr-1.5 h-3.5 w-3.5 shrink-0" />
                  {a.name}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
      {onReply ? (
        <button
          type="button"
          onClick={onReply}
          className="mt-1 inline-flex items-center gap-1 px-1 text-[11px] text-faint-ink hover:text-ink"
        >
          <FaReply aria-hidden className="h-3 w-3" /> {replyLabel}
        </button>
      ) : null}
    </div>
  );
}

const URL_PATTERN = /(https?:\/\/[^\s<]+|www\.[^\s<]+)/g;

/** Turns URLs in plain text into links, leaving trailing punctuation outside. */
function linkify(text: string) {
  return text.split(URL_PATTERN).map((part, i) => {
    if (i % 2 === 0) return part;
    const trail = part.match(/[.,;:!?)\]}'"]+$/)?.[0] ?? "";
    const url = trail ? part.slice(0, -trail.length) : part;
    const href = url.startsWith("www.") ? `https://${url}` : url;
    return (
      <span key={i}>
        <a href={href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:opacity-80">
          {url}
        </a>
        {trail}
      </span>
    );
  });
}
