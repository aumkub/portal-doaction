import { useState } from "react";
import { useFetcher } from "react-router";
import type { IconType } from "react-icons";
import {
  FaCircleCheck,
  FaFaceLaughSquint,
  FaFaceSurprise,
  FaHeart,
  FaRegFaceSmile,
  FaThumbsUp,
} from "react-icons/fa6";

export const REACTIONS = ["like", "love", "haha", "wow", "done"] as const;
export type Reaction = (typeof REACTIONS)[number];

const ICONS: Record<Reaction, { Icon: IconType; color: string; label: string }> = {
  like: { Icon: FaThumbsUp, color: "text-[#2F6FED]", label: "Like" },
  love: { Icon: FaHeart, color: "text-rose-500", label: "Love" },
  haha: { Icon: FaFaceLaughSquint, color: "text-amber-500", label: "Haha" },
  wow: { Icon: FaFaceSurprise, color: "text-amber-500", label: "Wow" },
  done: { Icon: FaCircleCheck, color: "text-emerald-600", label: "Done" },
};

export interface ReactionSummary {
  reaction: string;
  count: number;
  mine: boolean;
  /** Names of who reacted, for the tooltip. */
  names: string[];
}

/** Reaction pills under a message plus a picker; toggles without a page navigation. */
export function ReactionBar({
  messageId,
  reactions,
  alignRight,
}: {
  messageId: string;
  reactions: ReactionSummary[];
  alignRight?: boolean;
}) {
  const fetcher = useFetcher();
  const [open, setOpen] = useState(false);

  // Optimistic: flip the reaction being submitted until the server answers.
  const pending = fetcher.formData?.get("reaction") as string | undefined;
  const shown = REACTIONS.map((key) => {
    const r = reactions.find((x) => x.reaction === key);
    let count = r?.count ?? 0;
    let mine = r?.mine ?? false;
    if (pending === key) {
      count += mine ? -1 : 1;
      mine = !mine;
    }
    return { key, count, mine, names: r?.names ?? [] };
  }).filter((r) => r.count > 0);

  const toggle = (reaction: Reaction) => {
    setOpen(false);
    fetcher.submit(
      { intent: "react", message_id: messageId, reaction },
      { method: "post" }
    );
  };

  return (
    <div className={`relative flex flex-wrap items-center gap-1 ${alignRight ? "flex-row-reverse" : ""}`}>
      {shown.map(({ key, count, mine, names }) => {
        const { Icon, color, label } = ICONS[key];
        return (
          <button
            key={key}
            type="button"
            onClick={() => toggle(key)}
            title={names.length ? names.join(", ") : label}
            className={`inline-flex h-6 items-center gap-1 rounded-full border px-2 text-[11px] tabular-nums transition-colors ${
              mine ? "border-ink/30 bg-ink/[0.06] text-ink" : "border-line bg-white text-muted-ink hover:bg-paper"
            }`}
          >
            <Icon aria-hidden className={`h-3 w-3 ${color}`} />
            {count}
          </button>
        );
      })}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Add reaction"
        aria-expanded={open}
        className="inline-flex h-6 w-6 items-center justify-center rounded-full text-faint-ink hover:bg-paper hover:text-ink"
      >
        <FaRegFaceSmile aria-hidden className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div
          className={`absolute bottom-7 z-10 flex gap-1 rounded-full border border-line bg-white p-1 shadow-lg ${
            alignRight ? "right-0" : "left-0"
          }`}
        >
          {REACTIONS.map((key) => {
            const { Icon, color, label } = ICONS[key];
            return (
              <button
                key={key}
                type="button"
                onClick={() => toggle(key)}
                aria-label={label}
                title={label}
                className="flex h-8 w-8 items-center justify-center rounded-full transition-transform hover:scale-125 hover:bg-paper"
              >
                <Icon aria-hidden className={`h-4 w-4 ${color}`} />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Groups raw reaction rows into per-message summaries. */
export function summarizeReactions(
  rows: { message_id: string; user_id: string; reaction: string; name: string | null }[],
  currentUserId: string
): Record<string, ReactionSummary[]> {
  const out: Record<string, ReactionSummary[]> = {};
  for (const row of rows) {
    const list = (out[row.message_id] ||= []);
    let s = list.find((x) => x.reaction === row.reaction);
    if (!s) list.push((s = { reaction: row.reaction, count: 0, mine: false, names: [] }));
    s.count += 1;
    if (row.user_id === currentUserId) s.mine = true;
    if (row.name) s.names.push(row.name);
  }
  return out;
}
