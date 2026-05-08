import { FaPaperclip } from "react-icons/fa6";

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
  attachments?: Array<{ id: string; name: string; href: string; icon?: string }>;
  alignRight?: boolean;
}) {
  const shouldAlignRight = alignRight ?? isClient;
  const attachmentClass = isClient
    ? "border-hairline bg-canvas text-charcoal hover:bg-surface"
    : "border-white/30 bg-white/10 text-white hover:bg-white/20";

  return (
    <div className={`flex ${shouldAlignRight ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm shadow-sm ${
          isClient
            ? "bg-canvas text-ink border border-hairline"
            : "bg-primary text-on-dark"
        }`}
      >
        {authorName ? (
          <p className="mb-1 text-xs font-medium opacity-80">{authorName}</p>
        ) : null}
        <p className="whitespace-pre-wrap">{message}</p>
        {attachments.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {attachments.map((a) => (
              <a
                key={a.id}
                href={a.href}
                target="_blank"
                rel="noopener noreferrer"
                className={`inline-flex items-center rounded-md border px-2.5 py-1 text-xs transition-colors ${attachmentClass}`}
              >
                <FaPaperclip className="mr-1" aria-hidden="true" />
                {a.name}
              </a>
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
