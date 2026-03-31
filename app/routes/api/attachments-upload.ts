import { generateId } from "~/lib/utils";
import { createDB } from "~/lib/db.server";
import { requireUser } from "~/lib/auth.server";

const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED_PREFIXES = ["image/", "video/"];
const ALLOWED_EXACT = ["application/pdf"];

function isAllowedMime(mime: string): boolean {
  if (ALLOWED_EXACT.includes(mime)) return true;
  return ALLOWED_PREFIXES.some((p) => mime.startsWith(p));
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

  if (!isAllowedMime(file.type)) {
    return Response.json({ error: "unsupported_type" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ error: "file_too_large" }, { status: 400 });
  }

  const key = `ticket_${ticketId}_${generateId(24)}`;
  await env.ATTACHMENTS.put(key, await file.arrayBuffer(), {
    httpMetadata: {
      contentType: file.type || "application/octet-stream",
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
      mimeType: file.type || "application/octet-stream",
      sizeBytes: file.size,
      url: `/api/attachments/${encodeURIComponent(key)}`,
    },
  });
}
