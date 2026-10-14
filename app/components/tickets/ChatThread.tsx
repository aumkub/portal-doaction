import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "~/lib/utils";

/** Show every message up to this many; beyond it, older ones fold away. */
const COLLAPSE_AFTER = 8;
/** How many of the newest messages stay visible while folded. */
const KEEP_LAST = 6;

// useLayoutEffect warns during SSR; the scroll position only matters in the browser.
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Scrollable conversation that opens at the newest message, like a chat app.
 * `first` (the ticket description) always shows at the top; when there are
 * many messages the middle folds behind a "show earlier" button.
 */
export function ChatThread({
  first,
  items,
  empty,
  showEarlierLabel,
  className,
}: {
  first?: ReactNode;
  /** Messages oldest → newest, each with a stable key. */
  items: Array<{ key: string; node: ReactNode }>;
  empty?: ReactNode;
  showEarlierLabel: (hidden: number) => string;
  className?: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  /** True while the reader is at (or near) the newest message. */
  const stickToBottom = useRef(true);
  const [expanded, setExpanded] = useState(false);

  // A link to a specific message (#msg-…) must not land on a folded one.
  useEffect(() => {
    if (window.location.hash.startsWith("#msg-")) setExpanded(true);
  }, []);

  const folded = !expanded && items.length > COLLAPSE_AFTER;
  const hidden = folded ? items.length - KEEP_LAST : 0;
  const visible = folded ? items.slice(-KEEP_LAST) : items;

  // Jump to the newest message on open and whenever one is added.
  useIsoLayoutEffect(() => {
    const el = scrollRef.current;
    stickToBottom.current = true;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items.length]);

  // Content keeps growing after first paint (web fonts, images, previews).
  // Stay pinned to the bottom through that, unless the reader scrolled up.
  useEffect(() => {
    const el = scrollRef.current;
    const content = contentRef.current;
    if (!el || !content || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (stickToBottom.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(content);
    return () => ro.disconnect();
  }, []);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  function expand() {
    // Keep the reader's place: unfolding adds content above them.
    const el = scrollRef.current;
    const fromBottom = el ? el.scrollHeight - el.scrollTop : 0;
    stickToBottom.current = false;
    setExpanded(true);
    requestAnimationFrame(() => {
      if (el) el.scrollTop = el.scrollHeight - fromBottom;
    });
  }

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      className={cn("overflow-y-auto overscroll-contain", className)}
      role="log"
      aria-live="polite"
    >
      <div ref={contentRef} className="flex flex-col gap-5 p-4 md:p-6">
        {first}
        {hidden > 0 && (
          <div className="flex items-center gap-3">
            <span className="h-px flex-1 bg-line" />
            <button
              type="button"
              onClick={expand}
              className="h-9 rounded-full border border-line bg-white px-4 text-xs font-semibold text-ink-soft hover:bg-paper"
            >
              {showEarlierLabel(hidden)}
            </button>
            <span className="h-px flex-1 bg-line" />
          </div>
        )}
        {visible.map((item) => (
          <div key={item.key}>{item.node}</div>
        ))}
        {items.length === 0 && empty}
      </div>
    </div>
  );
}
