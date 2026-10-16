import { FaFile, FaFileImage, FaFilePdf, FaFileVideo } from "react-icons/fa6";

export type AttachmentKind = "pdf" | "image" | "video" | "file";

export function attachmentKind(fileName: string, mimeType?: string): AttachmentKind {
  const lower = fileName.toLowerCase();
  if (mimeType === "application/pdf" || lower.endsWith(".pdf")) return "pdf";
  if (mimeType?.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg)$/.test(lower)) return "image";
  if (mimeType?.startsWith("video/") || /\.(mp4|mov|webm|mkv|avi)$/.test(lower)) return "video";
  return "file";
}

const ICONS = { pdf: FaFilePdf, image: FaFileImage, video: FaFileVideo, file: FaFile };

export function AttachmentIcon({ kind, className }: { kind?: string; className?: string }) {
  const Icon = ICONS[kind as AttachmentKind] ?? FaFile;
  return <Icon aria-hidden className={className ?? "inline h-3.5 w-3.5 shrink-0"} />;
}
