import type { createDB } from "~/lib/db.server";

export type AttachmentStorageItem = {
  fileKey: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: number;
  status: "linked" | "temporary";
  id?: string;
  ticketId?: string;
  ticketTitle?: string;
  messageId?: string;
  messageText?: string | null;
  uploaderName?: string;
  missingFromStorage?: boolean;
};

function parseTicketIdFromKey(key: string): string | undefined {
  if (!key.startsWith("ticket_")) return undefined;
  const rest = key.slice("ticket_".length);
  const lastUnderscore = rest.lastIndexOf("_");
  if (lastUnderscore <= 0) return rest || undefined;
  return rest.slice(0, lastUnderscore);
}

async function listAllR2Objects(bucket: R2Bucket): Promise<R2Object[]> {
  const objects: R2Object[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix: "ticket_", cursor, limit: 1000 });
    objects.push(...page.objects);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return objects;
}

export async function listAllStorageAttachments(
  bucket: R2Bucket,
  db: ReturnType<typeof createDB>
): Promise<AttachmentStorageItem[]> {
  const dbRows = await db.listAllTicketAttachments();
  const byKey = new Map(dbRows.map((r) => [r.file_key, r]));
  const r2Objects = await listAllR2Objects(bucket);
  const items: AttachmentStorageItem[] = [];
  const seenKeys = new Set<string>();

  for (const obj of r2Objects) {
    seenKeys.add(obj.key);
    const dbRow = byKey.get(obj.key);
    const fileName =
      obj.customMetadata?.fileName || dbRow?.file_name || obj.key.split("/").pop() || obj.key;
    const mimeType =
      obj.httpMetadata?.contentType || dbRow?.mime_type || "application/octet-stream";
    const uploadedAt = obj.uploaded
      ? Math.floor(obj.uploaded.getTime() / 1000)
      : dbRow?.created_at ?? 0;

    if (dbRow) {
      items.push({
        fileKey: obj.key,
        fileName,
        mimeType,
        sizeBytes: dbRow.size_bytes,
        uploadedAt: dbRow.created_at,
        status: "linked",
        id: dbRow.id,
        ticketId: dbRow.ticket_id,
        ticketTitle: dbRow.ticket_title,
        messageId: dbRow.message_id,
        messageText: dbRow.message_text,
        uploaderName: dbRow.uploader_name,
      });
    } else {
      const ticketId = obj.customMetadata?.ticketId || parseTicketIdFromKey(obj.key);
      items.push({
        fileKey: obj.key,
        fileName,
        mimeType,
        sizeBytes: obj.size,
        uploadedAt,
        status: "temporary",
        ticketId,
      });
    }
  }

  for (const row of dbRows) {
    if (seenKeys.has(row.file_key)) continue;
    items.push({
      fileKey: row.file_key,
      fileName: row.file_name,
      mimeType: row.mime_type,
      sizeBytes: row.size_bytes,
      uploadedAt: row.created_at,
      status: "linked",
      id: row.id,
      ticketId: row.ticket_id,
      ticketTitle: row.ticket_title,
      messageId: row.message_id,
      messageText: row.message_text,
      uploaderName: row.uploader_name,
      missingFromStorage: true,
    });
  }

  const ticketIds = [
    ...new Set(
      items
        .filter((i) => i.status === "temporary" && i.ticketId && !i.ticketTitle)
        .map((i) => i.ticketId as string)
    ),
  ];
  const ticketTitles = new Map<string, string>();
  await Promise.all(
    ticketIds.map(async (id) => {
      const ticket = await db.getTicket(id);
      if (ticket) ticketTitles.set(id, ticket.title);
    })
  );

  for (const item of items) {
    if (item.ticketId && !item.ticketTitle) {
      item.ticketTitle = ticketTitles.get(item.ticketId);
    }
  }

  items.sort((a, b) => b.uploadedAt - a.uploadedAt);
  return items;
}

export async function listTemporaryAttachmentKeys(
  bucket: R2Bucket,
  db: ReturnType<typeof createDB>
): Promise<string[]> {
  const items = await listAllStorageAttachments(bucket, db);
  return items.filter((i) => i.status === "temporary").map((i) => i.fileKey);
}
