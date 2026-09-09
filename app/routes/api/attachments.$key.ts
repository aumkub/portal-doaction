import { requireUser } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";

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
    const client = await db.getClientByUserId(user.id);
    if (!client || client.id !== ticket.client_id) {
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

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("content-disposition", `inline; filename="${attachment.file_name}"`);
  // Keys are unique per upload and never rewritten, so the body is immutable.
  headers.set("cache-control", "private, max-age=31536000, immutable");

  return new Response(object.body, { headers });
}
