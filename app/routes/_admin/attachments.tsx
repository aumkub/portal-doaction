import { Form } from "react-router";
import { requireAdmin } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";
import { formatDate } from "~/lib/utils";
import { useT } from "~/lib/i18n";
import PageHeader from "~/components/layout/PageHeader";
import { FaPaperclip } from "react-icons/fa6";

export function meta() {
  return [{ title: "ไฟล์แนบ Ticket — Admin" }];
}

export async function loader({ request, context }: any) {
  const env = context.cloudflare.env;
  await requireAdmin(request, env.DB, env.SESSIONPORTAL);
  const db = createDB(env.DB);
  const attachments = await db.listAllTicketAttachments();
  return { attachments };
}

export async function action({ request, context }: any) {
  const env = context.cloudflare.env;
  await requireAdmin(request, env.DB, env.SESSIONPORTAL);
  const db = createDB(env.DB);

  const formData = await request.formData();
  const intent = formData.get("intent");
  const attachmentId = formData.get("attachmentId");
  if (intent !== "delete" || typeof attachmentId !== "string" || !attachmentId) {
    return { ok: false };
  }

  const attachment = await db.getTicketAttachmentById(attachmentId);
  if (!attachment) return { ok: false };

  await env.ATTACHMENTS.delete(attachment.file_key);
  await db.deleteTicketAttachment(attachmentId);
  return { ok: true };
}

export default function AdminAttachmentsPage({ loaderData }: any) {
  const { attachments } = loaderData as {
    attachments: Array<{
      id: string;
      ticket_id: string;
      message_id: string;
      file_key: string;
      file_name: string;
      mime_type: string;
      size_bytes: number;
      created_at: number;
      ticket_title: string;
      message_text: string | null;
      uploader_name: string;
    }>;
  };
  const { t, lang } = useT();

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("nav_attachments")}
        subtitle={`${attachments.length} files`}
        breadcrumbs={[
          { label: t("admin_breadcrumb_admin"), href: "/admin/clients" },
          { label: t("nav_attachments") },
        ]}
      />

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="text-left text-xs font-medium text-slate-500 px-5 py-3">File</th>
                <th className="text-left text-xs font-medium text-slate-500 px-5 py-3">Ticket</th>
                <th className="text-left text-xs font-medium text-slate-500 px-5 py-3">Reply</th>
                <th className="text-left text-xs font-medium text-slate-500 px-5 py-3">Uploaded by</th>
                <th className="text-left text-xs font-medium text-slate-500 px-5 py-3">Date</th>
                <th className="text-right text-xs font-medium text-slate-500 px-5 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {attachments.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center text-slate-500">
                    No attachments
                  </td>
                </tr>
              ) : (
                attachments.map((a) => (
                  <tr key={a.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-5 py-4">
                      <a
                        href={`/api/attachments/${encodeURIComponent(a.file_key)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 text-slate-700 hover:text-slate-900"
                      >
                        <FaPaperclip aria-hidden="true" />
                        <span>{a.file_name}</span>
                      </a>
                      <p className="text-[11px] text-slate-500 mt-1">
                        {(a.size_bytes / 1024).toFixed(1)} KB
                      </p>
                    </td>
                    <td className="px-5 py-4 text-slate-700">{a.ticket_title}</td>
                    <td className="px-5 py-4">
                      {a.message_text ? (
                        <a
                          href={`/admin/tickets/${a.ticket_id}#msg-${a.message_id}`}
                          className="text-violet-600 hover:text-violet-800 text-xs underline underline-offset-2"
                        >
                          {a.message_text.slice(0, 70)}
                        </a>
                      ) : (
                        <span className="text-xs text-slate-500 italic">(ไม่ได้ส่ง)</span>
                      )}
                    </td>
                    <td className="px-5 py-4 text-slate-600">{a.uploader_name}</td>
                    <td className="px-5 py-4 text-slate-500">{formatDate(a.created_at, lang)}</td>
                    <td className="px-5 py-4 text-right">
                      <Form method="post">
                        <input type="hidden" name="intent" value="delete" />
                        <input type="hidden" name="attachmentId" value={a.id} />
                        <button
                          type="submit"
                          className="rounded border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs text-rose-700 hover:bg-rose-100"
                        >
                          Delete
                        </button>
                      </Form>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
