import type { DragEvent, ReactNode } from "react";
import { cn } from "~/lib/utils";

type DropHandlers = {
  onDragEnter: (e: DragEvent<HTMLDivElement>) => void;
  onDragLeave: (e: DragEvent<HTMLDivElement>) => void;
  onDragOver: (e: DragEvent<HTMLDivElement>) => void;
  onDrop: (e: DragEvent<HTMLDivElement>) => void;
};

export function TicketReplyDropZone({
  isDragging,
  dropHandlers,
  dropLabel,
  children,
  className,
}: {
  isDragging: boolean;
  dropHandlers: DropHandlers;
  dropLabel: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn("relative transition-colors", className)}
      {...dropHandlers}
    >
      {isDragging && (
        <div
          className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-ink/40 bg-white/90"
          aria-hidden
        >
          <p className="text-sm font-medium text-ink-soft">{dropLabel}</p>
        </div>
      )}
      {children}
    </div>
  );
}
