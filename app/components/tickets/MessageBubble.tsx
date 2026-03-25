export default function MessageBubble({
  message,
  isClient,
  isInternal,
  authorName,
}: {
  message: string;
  isClient: boolean;
  isInternal: boolean;
  authorName?: string;
}) {
  return (
    <div className={`flex ${isClient ? "justify-end" : "justify-start"}`}>
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
        {isInternal ? (
          <p className="mt-2 text-[11px] uppercase tracking-wide opacity-75">
            Internal note
          </p>
        ) : null}
      </div>
    </div>
  );
}
