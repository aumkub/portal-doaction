import { useEffect, useCallback, useState, useRef } from "react";

export interface LightboxItem {
  id: string;
  name: string;
  href: string;
  icon?: string;
}

interface Props {
  items: LightboxItem[];
  initialIndex: number;
  onClose: () => void;
}

export default function AttachmentLightbox({ items, initialIndex, onClose }: Props) {
  const [index, setIndex] = useState(initialIndex);
  const [zoom, setZoom] = useState(1);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const imgRef = useRef<HTMLImageElement>(null);

  const current = items[index];
  const isImage = current.icon === "🖼️";
  const total = items.length;

  const resetView = () => { setZoom(1); setPan({ x: 0, y: 0 }); };

  const prev = useCallback(() => {
    setIndex(i => (i - 1 + total) % total);
    resetView();
  }, [total]);

  const next = useCallback(() => {
    setIndex(i => (i + 1) % total);
    resetView();
  }, [total]);

  useEffect(() => {
    setIndex(initialIndex);
    resetView();
  }, [initialIndex]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") prev();
      if (e.key === "ArrowRight") next();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, prev, next]);

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    setZoom(z => Math.min(5, Math.max(1, z - e.deltaY * 0.003)));
  };

  const handleImageClick = (e: React.MouseEvent) => {
    if (zoom === 1) setZoom(2.5);
    else resetView();
  };

  const handleDragStart = (e: React.MouseEvent) => {
    if (zoom <= 1) return;
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handleDragMove = (e: React.MouseEvent) => {
    if (!dragStart) return;
    setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
  };

  const handleDragEnd = () => setDragStart(null);

  const backdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/92 select-none"
      onClick={backdropClick}
    >
      {/* Top bar */}
      <div className="absolute top-0 inset-x-0 flex items-center justify-between px-4 py-3 z-10 pointer-events-none">
        <span className="text-white/50 text-sm tabular-nums pointer-events-auto">
          {total > 1 ? `${index + 1} / ${total}` : ""}
        </span>
        <p className="text-white text-sm font-medium max-w-xs truncate pointer-events-auto">
          {current.name}
        </p>
        <button
          onClick={onClose}
          className="pointer-events-auto w-8 h-8 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/25 text-white text-lg leading-none transition-colors"
        >
          ×
        </button>
      </div>

      {/* Prev */}
      {total > 1 && (
        <button
          onClick={prev}
          className="absolute left-3 top-1/2 -translate-y-1/2 z-10 w-10 h-10 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/25 text-white text-2xl leading-none transition-colors"
        >
          ‹
        </button>
      )}

      {/* Next */}
      {total > 1 && (
        <button
          onClick={next}
          className="absolute right-3 top-1/2 -translate-y-1/2 z-10 w-10 h-10 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/25 text-white text-2xl leading-none transition-colors"
        >
          ›
        </button>
      )}

      {/* Content */}
      <div
        className="relative overflow-hidden"
        style={{ maxWidth: "90vw", maxHeight: "85vh" }}
        onWheel={isImage ? handleWheel : undefined}
      >
        {isImage ? (
          <img
            ref={imgRef}
            src={current.href}
            alt={current.name}
            onClick={handleImageClick}
            onMouseDown={handleDragStart}
            onMouseMove={handleDragMove}
            onMouseUp={handleDragEnd}
            onMouseLeave={handleDragEnd}
            draggable={false}
            style={{
              transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`,
              transition: dragStart ? "none" : "transform 0.2s ease",
              cursor: zoom > 1 ? (dragStart ? "grabbing" : "grab") : "zoom-in",
              maxWidth: "85vw",
              maxHeight: "80vh",
              objectFit: "contain",
              display: "block",
              userSelect: "none",
            }}
          />
        ) : (
          <div className="flex flex-col items-center gap-5 px-16 py-12 rounded-2xl bg-white/5 text-white text-center">
            <span className="text-7xl leading-none">{current.icon ?? "📎"}</span>
            <p className="text-base font-medium max-w-xs break-all">{current.name}</p>
            <a
              href={current.href}
              target="_blank"
              rel="noopener noreferrer"
              className="px-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-sm font-medium transition-colors"
              onClick={e => e.stopPropagation()}
            >
              เปิดไฟล์ →
            </a>
          </div>
        )}
      </div>

      {/* Zoom hint */}
      {isImage && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/30 text-xs pointer-events-none">
          {zoom === 1 ? "คลิกหรือ scroll เพื่อซูม" : `${Math.round(zoom * 100)}%  · คลิกเพื่อรีเซ็ต`}
        </div>
      )}

      {/* Thumbnail strip */}
      {total > 1 && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-1.5 z-10">
          {items.map((item, i) => (
            <button
              key={item.id}
              onClick={() => { setIndex(i); resetView(); }}
              className={`w-2 h-2 rounded-full transition-colors ${i === index ? "bg-white" : "bg-white/30 hover:bg-white/60"}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
