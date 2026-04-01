const MAX_BYTES = 2 * 1024 * 1024;

export async function prepareAttachmentForUpload(file: File): Promise<File> {
  if (file.type.startsWith("image/")) {
    const compressed = await compressImage(file);
    if (compressed.size <= MAX_BYTES) return compressed;
  }
  return file;
}

async function compressImage(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  const maxW = 1920;
  const scale = Math.min(1, maxW / bitmap.width);
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));

  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  let quality = 0.85;
  let blob: Blob | null = null;
  while (quality >= 0.45) {
    blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", quality)
    );
    if (!blob) break;
    if (blob.size <= MAX_BYTES) {
      return new File([blob], replaceExt(file.name, "jpg"), {
        type: "image/jpeg",
        lastModified: Date.now(),
      });
    }
    quality -= 0.1;
  }
  return file;
}

function replaceExt(fileName: string, ext: string): string {
  const idx = fileName.lastIndexOf(".");
  if (idx === -1) return `${fileName}.${ext}`;
  return `${fileName.slice(0, idx)}.${ext}`;
}

export function isAllowedAttachment(file: File): boolean {
  return (
    file.type === "application/pdf" ||
    file.type.startsWith("image/") ||
    file.type.startsWith("video/")
  );
}

export function isAttachmentTooLarge(file: File): boolean {
  return file.size > MAX_BYTES;
}

export async function uploadAttachment(params: {
  ticketId: string;
  file: File;
  onProgress?: (percent: number) => void;
}): Promise<{
  fileKey: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
}> {
  const { ticketId, file, onProgress } = params;
  const formData = new FormData();
  formData.append("ticketId", ticketId);
  formData.append("file", file);

  return await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/attachments-upload");

    xhr.upload.onprogress = (evt) => {
      if (!evt.lengthComputable || !onProgress) return;
      onProgress(Math.round((evt.loaded / evt.total) * 100));
    };

    xhr.onerror = () => reject(new Error("Upload failed"));
    xhr.onload = () => {
      const text = xhr.responseText ?? "";
      let payload: any = null;
      try {
        payload = text ? JSON.parse(text) : null;
      } catch {
        reject(new Error("Upload response is not valid JSON"));
        return;
      }

      if (xhr.status < 200 || xhr.status >= 300 || !payload?.file) {
        reject(new Error(payload?.error || "Upload failed"));
        return;
      }

      resolve(payload.file);
    };

    xhr.send(formData);
  });
}

export async function cleanupOrphanAttachment(params: {
  ticketId: string;
  fileKey: string;
}): Promise<void> {
  const formData = new FormData();
  formData.append("intent", "cleanup_orphan");
  formData.append("ticketId", params.ticketId);
  formData.append("fileKey", params.fileKey);
  await fetch("/api/attachments-upload", {
    method: "POST",
    body: formData,
    credentials: "same-origin",
  });
}
