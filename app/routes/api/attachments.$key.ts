import { requireUser } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";

const INLINE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/heic",
  "image/heif",
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "application/pdf",
]);

/** RFC 6266 header with an ASCII fallback, so a crafted name cannot break out of the quotes. */
function contentDisposition(inline: boolean, fileName: string): string {
  const fallback = fileName.replace(/[^\x20-\x7e]|["\\]/g, "_");
  return `${inline ? "inline" : "attachment"}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export async function loader({ request, context, params }: any) {
  const env = context.cloudflare.env;
  const user = await requireUser(request, env.DB, env.SESSIONPORTAL);
  const db = createDB(env.DB);
  const key = decodeURIComponent(params.key as string);

  const attachment = await db.getTicketAttachmentByKey(key);
  if (!attachment) return new Response("Not Found", { status: 404 });

  const ticket = await db.getTicket(attachment.ticket_id);
  if (!ticket) return new Response("Not Found", { status: 404 });

  if (user.role === "client") {
    const [client, message] = await Promise.all([
      db.getClientByUserId(user.id),
      db.getTicketMessage(attachment.message_id),
    ]);
    if (!client || client.id !== ticket.client_id) {
      return new Response("Forbidden", { status: 403 });
    }
    // Files on internal notes are team-only.
    if (!message || message.is_internal === 1) {
      return new Response("Forbidden", { status: 403 });
    }
  }

  if (user.role === "co-admin") {
    const assignments = await db.listCoAdminClients(user.id);
    if (!assignments.some((a) => a.client_id === ticket.client_id)) {
      return new Response("Forbidden", { status: 403 });
    }
  }

  const object = await env.ATTACHMENTS.get(key);
  if (!object) return new Response("Not Found", { status: 404 });

  // Only types the upload route verifies may render inline; anything else
  // (including files stored before that check existed) is forced to download.
  const contentType = object.httpMetadata?.contentType ?? "";
  const inline = INLINE_TYPES.has(contentType);
  const headers = new Headers();
  headers.set("content-type", inline ? contentType : "application/octet-stream");
  headers.set("etag", object.httpEtag);
  headers.set("content-disposition", contentDisposition(inline, attachment.file_name));
  headers.set("x-content-type-options", "nosniff");
  headers.set("content-security-policy", "default-src 'none'; sandbox");
  // Keys are unique per upload and never rewritten, so the body is immutable.
  headers.set("cache-control", "private, max-age=31536000, immutable");

  return new Response(object.body, { headers });
}
