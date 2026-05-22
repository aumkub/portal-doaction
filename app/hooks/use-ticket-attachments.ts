import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
} from "react";
import {
  cleanupOrphanAttachment,
  isAllowedAttachment,
  isAttachmentTooLarge,
  prepareAttachmentForUpload,
  uploadAttachment,
} from "~/lib/file-upload.client";

export type UploadedAttachment = {
  fileKey: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
};

function inferClipboardMime(blob: File): string {
  if (blob.type) return blob.type;
  const lower = blob.name.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (/\.(mp4|webm|mov|m4v|ogg)$/.test(lower)) return "video/mp4";
  if (/\.(jpe?g|png|gif|webp|bmp)$/.test(lower)) return "image/png";
  return "";
}

function clipboardBlobToFile(blob: File): File {
  const type = inferClipboardMime(blob);
  const hasName = blob.name && blob.name !== "blob" && blob.name !== "image.png";
  if (hasName) {
    return type && type !== blob.type
      ? new File([blob], blob.name, { type, lastModified: blob.lastModified })
      : blob;
  }

  const ts = Date.now();
  if (type === "application/pdf") {
    return new File([blob], `pasted-${ts}.pdf`, { type });
  }
  if (type.startsWith("video/")) {
    const ext = type.split("/")[1]?.replace("quicktime", "mov") || "mp4";
    return new File([blob], `pasted-${ts}.${ext}`, { type });
  }
  if (type.startsWith("image/")) {
    const ext = type.split("/")[1]?.replace("jpeg", "jpg") || "png";
    return new File([blob], `pasted-${ts}.${ext}`, { type: type || "image/png" });
  }
  return blob;
}

/** PDF, image, or video files from clipboard (Ctrl+V). */
export function getAttachmentFilesFromClipboard(e: ClipboardEvent): File[] {
  const files: File[] = [];
  const dt = e.clipboardData;
  if (!dt) return files;

  if (dt.items?.length) {
    for (const item of Array.from(dt.items)) {
      if (item.kind !== "file") continue;
      const blob = item.getAsFile();
      if (!blob) continue;
      const file = clipboardBlobToFile(blob);
      if (isAllowedAttachment(file)) files.push(file);
    }
  }

  if (files.length === 0 && dt.files?.length) {
    for (const raw of Array.from(dt.files)) {
      const file = clipboardBlobToFile(raw);
      if (isAllowedAttachment(file)) files.push(file);
    }
  }

  return files;
}

function getFilesFromDataTransfer(dataTransfer: DataTransfer | null): File[] {
  if (!dataTransfer?.files?.length) return [];
  return Array.from(dataTransfer.files);
}

type Options = {
  ticketId: string;
  invalidTypeMessage?: string;
  tooLargeMessage?: string;
  uploadFailedMessage?: string;
};

export function useTicketAttachments({
  ticketId,
  invalidTypeMessage = "PDF, image, and video only",
  tooLargeMessage = "Max file size is 2MB",
  uploadFailedMessage = "Upload failed",
}: Options) {
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState("");
  const [uploadedFiles, setUploadedFiles] = useState<UploadedAttachment[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const skipCleanupRef = useRef(false);
  const dragDepthRef = useRef(0);

  const uploadFiles = useCallback(
    async (fileList: File[]) => {
      if (fileList.length === 0) return;
      setUploadError("");
      setUploading(true);
      setUploadProgress(0);
      try {
        for (const rawFile of fileList) {
          if (!isAllowedAttachment(rawFile)) {
            throw new Error(invalidTypeMessage);
          }
          const prepared = await prepareAttachmentForUpload(rawFile);
          if (isAttachmentTooLarge(prepared)) {
            throw new Error(tooLargeMessage);
          }
          const uploaded = await uploadAttachment({
            ticketId,
            file: prepared,
            onProgress: (percent) => setUploadProgress(percent),
          });
          setUploadedFiles((prev) => [...prev, uploaded]);
        }
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : uploadFailedMessage);
      } finally {
        setUploading(false);
        setUploadProgress(0);
      }
    },
    [ticketId, invalidTypeMessage, tooLargeMessage, uploadFailedMessage]
  );

  const onFileInputChange = useCallback(
    (fileList: FileList | null) => {
      if (!fileList?.length) return;
      void uploadFiles(Array.from(fileList));
    },
    [uploadFiles]
  );

  const onPaste = useCallback(
    (e: ClipboardEvent<HTMLTextAreaElement>) => {
      const pasted = getAttachmentFilesFromClipboard(e);
      if (pasted.length === 0) return;
      e.preventDefault();
      void uploadFiles(pasted);
    },
    [uploadFiles]
  );

  const onDragEnter = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!e.dataTransfer.types.includes("Files")) return;
    dragDepthRef.current += 1;
    setIsDragging(true);
  }, []);

  const onDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!e.dataTransfer.types.includes("Files")) return;
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDragging(false);
  }, []);

  const onDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types.includes("Files")) {
      e.dataTransfer.dropEffect = "copy";
    }
  }, []);

  const onDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      dragDepthRef.current = 0;
      setIsDragging(false);
      void uploadFiles(getFilesFromDataTransfer(e.dataTransfer));
    },
    [uploadFiles]
  );

  const removeFile = useCallback(
    (fileKey: string) => {
      setUploadedFiles((prev) => prev.filter((item) => item.fileKey !== fileKey));
      void cleanupOrphanAttachment({ ticketId, fileKey });
    },
    [ticketId]
  );

  const markSubmitSuccess = useCallback(() => {
    skipCleanupRef.current = true;
    setUploadedFiles([]);
    setUploadError("");
  }, []);

  useEffect(() => {
    const cleanup = () => {
      if (skipCleanupRef.current || uploadedFiles.length === 0) return;
      for (const f of uploadedFiles) {
        void cleanupOrphanAttachment({ ticketId, fileKey: f.fileKey });
      }
    };
    window.addEventListener("beforeunload", cleanup);
    return () => {
      window.removeEventListener("beforeunload", cleanup);
      cleanup();
    };
  }, [ticketId, uploadedFiles]);

  return {
    uploading,
    uploadProgress,
    uploadError,
    uploadedFiles,
    isDragging,
    attachmentsJson: JSON.stringify(uploadedFiles),
    onFileInputChange,
    onPaste,
    removeFile,
    markSubmitSuccess,
    dropZoneProps: { onDragEnter, onDragLeave, onDragOver, onDrop },
  };
}
