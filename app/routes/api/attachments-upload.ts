import { generateId } from "~/lib/utils";
import { createDB } from "~/lib/db.server";
import { requireUser } from "~/lib/auth.server";

const MAX_BYTES = 2 * 1024 * 1024;
/**
 * Accepted types, each checked against the file's leading bytes. The browser
 * supplies `file.type`, so it cannot be trusted on its own: an SVG or HTML
 * file labelled as an image would otherwise be served back as active content.
 */
const SIGNATURES: Record<string, (b: Uint8Array) => boolean> = {
  "image/png": (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  "image/jpeg": (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/gif": (b) => ascii(b, 0, 4) === "GIF8",
  "image/webp": (b) => ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP",
  "image/heic": isIsoMedia,
  "image/heif": isIsoMedia,
  "video/mp4": isIsoMedia,
  "video/quicktime": isIsoMedia,
  "video/webm": (b) => b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3,
  "application/pdf": (b) => ascii(b, 0, 5) === "%PDF-",
};

function ascii(b: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...b.subarray(start, end));
}

function isIsoMedia(b: Uint8Array): boolean {
  return ascii(b, 4, 8) === "ftyp";
}

async function hasValidSignature(file: File): Promise<boolean> {
  const check = SIGNATURES[file.type];
  if (!check) return false;
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  return check(head);
}

export async function action({ request, context }: any) {
  const env = context.cloudflare.env;
  const user = await requireUser(request, env.DB, env.SESSIONPORTAL);
  const db = createDB(env.DB);

  const formData = await request.formData();
  const intent = formData.get("intent");
  if (intent === "cleanup_orphan") {
    const ticketId = formData.get("ticketId");
    const fileKey = formData.get("fileKey");
    if (
      typeof ticketId !== "string" ||
      !ticketId ||
      typeof fileKey !== "string" ||
      !fileKey
    ) {
      return Response.json({ error: "invalid_payload" }, { status: 400 });
    }

    const ticket = await db.getTicket(ticketId);
    if (!ticket) return Response.json({ error: "ticket_not_found" }, { status: 404 });

    if (user.role === "client") {
      const client = await db.getClientByUserId(user.id);
      if (!client || client.id !== ticket.client_id) {
        return Response.json({ error: "forbidden" }, { status: 403 });
      }
    }

    if (user.role === "co-admin") {
      const assignments = await db.listCoAdminClients(user.id);
      if (!assignments.some((a) => a.client_id === ticket.client_id)) {
        return Response.json({ error: "forbidden" }, { status: 403 });
      }
    }

    const linkedAttachment = await db.getTicketAttachmentByKey(fileKey);
    if (linkedAttachment) {
      return Response.json({ ok: true, skipped: "linked" });
    }

    await env.ATTACHMENTS.delete(fileKey);
    return Response.json({ ok: true });
  }

  const ticketId = formData.get("ticketId");
  const file = formData.get("file");
  if (typeof ticketId !== "string" || !ticketId || !(file instanceof File)) {
    return Response.json({ error: "invalid_payload" }, { status: 400 });
  }

  const ticket = await db.getTicket(ticketId);
  if (!ticket) return Response.json({ error: "ticket_not_found" }, { status: 404 });

  if (user.role === "client") {
    const client = await db.getClientByUserId(user.id);
    if (!client || client.id !== ticket.client_id) {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }
  }

  if (user.role === "co-admin") {
    const assignments = await db.listCoAdminClients(user.id);
    if (!assignments.some((a) => a.client_id === ticket.client_id)) {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }
  }

  if (!(await hasValidSignature(file))) {
    return Response.json({ error: "unsupported_type" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ error: "file_too_large" }, { status: 400 });
  }

  const key = `ticket_${ticketId}_${generateId(24)}`;
  await env.ATTACHMENTS.put(key, await file.arrayBuffer(), {
    httpMetadata: {
      contentType: file.type,
    },
    customMetadata: {
      ticketId,
      uploaderUserId: user.id,
      fileName: file.name,
    },
  });

  return Response.json({
    ok: true,
    file: {
      fileKey: key,
      fileName: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      url: `/api/attachments/${encodeURIComponent(key)}`,
    },
  });
}
