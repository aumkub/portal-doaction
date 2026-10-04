import { Form, useNavigation } from "react-router";
import { requireAdmin } from "~/lib/auth.server";
import {
  listAllStorageAttachments,
  listTemporaryAttachmentKeys,
  type AttachmentStorageItem,
} from "~/lib/attachments.server";
import { createDB } from "~/lib/db.server";
import { formatDate } from "~/lib/utils";
import { useT } from "~/lib/i18n";
import PageHeader from "~/components/layout/PageHeader";
import { FaPaperclip, FaTrash } from "react-icons/fa6";
import Pagination from "~/components/ui/Pagination";

export function meta() {
  return [{ title: "ไฟล์แนบ — Admin" }];
}

const PAGE_SIZE = 20;

export async function loader({ request, context }: any) {
  const env = context.cloudflare.env;
  await requireAdmin(request, env.DB, env.SESSIONPORTAL);
  const db = createDB(env.DB);
  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1"));
  const all = await listAllStorageAttachments(env.ATTACHMENTS, db);
  const temporaryCount = all.filter((a) => a.status === "temporary").length;
  const total = all.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const attachments = all.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  return { attachments, temporaryCount, page: safePage, totalPages, total };
}

export async function action({ request, context }: any) {
  const env = context.cloudflare.env;
  await requireAdmin(request, env.DB, env.SESSIONPORTAL);
  const db = createDB(env.DB);

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "clear_temporary") {
    const keys = await listTemporaryAttachmentKeys(env.ATTACHMENTS, db);
    await Promise.all(keys.map((key) => env.ATTACHMENTS.delete(key)));
    return { ok: true, cleared: keys.length };
  }

  if (intent === "delete_key") {
    const fileKey = formData.get("fileKey");
    if (typeof fileKey !== "string" || !fileKey) return { ok: false };

    const linked = await db.getTicketAttachmentByKey(fileKey);
    if (linked) {
      await env.ATTACHMENTS.delete(fileKey);
      await db.deleteTicketAttachment(linked.id);
    } else {
      await env.ATTACHMENTS.delete(fileKey);
    }
    return { ok: true };
  }

  const attachmentId = formData.get("attachmentId");
  if (intent === "delete" && typeof attachmentId === "string" && attachmentId) {
    const attachment = await db.getTicketAttachmentById(attachmentId);
    if (!attachment) return { ok: false };

    const object = await env.ATTACHMENTS.head(attachment.file_key);
    if (object) await env.ATTACHMENTS.delete(attachment.file_key);
    await db.deleteTicketAttachment(attachmentId);
    return { ok: true };
  }

  return { ok: false };
}

function StatusBadge({ status, t }: { status: AttachmentStorageItem["status"]; t: (k: string) => string }) {
  if (status === "temporary") {
    return (
      <span className="inline-flex items-center rounded-full bg-[#FFF6C2] px-2.5 py-0.5 text-xs font-semibold text-[#6B5B00]">
        {t("admin_attachments_status_temporary")}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
      {t("admin_attachments_status_linked")}
    </span>
  );
}

export default function AdminAttachmentsPage({ loaderData }: any) {
  const { attachments, temporaryCount, page, totalPages } = loaderData as {
    attachments: AttachmentStorageItem[];
    temporaryCount: number;
    page: number;
    totalPages: number;
    total: number;
  };
  const { t, lang } = useT();
  const navigation = useNavigation();
  const isClearing =
    navigation.state !== "idle" &&
    navigation.formData?.get("intent") === "clear_temporary";

  const linkedCount = attachments.filter((a) => a.status === "linked").length;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("nav_attachments")}
        subtitle={t("admin_attachments_subtitle", {
          total: String(attachments.length),
          linked: String(linkedCount),
          temporary: String(temporaryCount),
        })}
        breadcrumbs={[
          { label: t("admin_breadcrumb_admin"), href: "/admin/clients" },
          { label: t("nav_attachments") },
        ]}
      />

      {temporaryCount > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[16px] border border-[#E3CF5C] bg-[#FFF8CC] px-4 py-3">
          <p className="text-sm text-[#3A3000]">
            {t("admin_attachments_temporary_hint", { count: String(temporaryCount) })}
          </p>
          <Form method="post">
            <input type="hidden" name="intent" value="clear_temporary" />
            <button
              type="submit"
              disabled={isClearing}
              className="inline-flex items-center gap-2 h-10 rounded-full border border-line bg-white px-3.5 text-[13px] font-medium text-ink-soft hover:bg-paper disabled:opacity-60"
            >
              <FaTrash aria-hidden="true" className="text-xs" />
              {isClearing ? t("admin_attachments_clearing") : t("admin_attachments_clear_all")}
            </button>
          </Form>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-[20px] border border-line bg-white ">
        <div className="md:hidden divide-y divide-[#F4F2EC]">
          {attachments.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-muted-ink">{t("admin_attachments_empty")}</p>
          ) : (
            attachments.map((a) => (
              <div
                key={a.fileKey}
                className={`space-y-2 px-5 py-4 ${a.status === "temporary" ? "bg-[#FFF8CC]/50" : ""}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="inline-flex min-w-0 items-center gap-2 text-sm font-medium text-ink">
                    <FaPaperclip aria-hidden="true" className="shrink-0 text-faint-ink" />
                    {a.status === "linked" && !a.missingFromStorage ? (
                      <a
                        href={`/api/attachments/${encodeURIComponent(a.fileKey)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="truncate hover:underline"
                      >
                        {a.fileName}
                      </a>
                    ) : (
                      <span className="truncate">{a.fileName}</span>
                    )}
                  </span>
                  <StatusBadge status={a.status} t={t} />
                </div>
                {a.missingFromStorage ? (
                  <p className="text-[11px] text-[#B4541A]">{t("admin_attachments_missing_storage")}</p>
                ) : null}
                {a.ticketId ? (
                  <a href={`/admin/tickets/${a.ticketId}`} className="block truncate text-[13px] text-ink-soft hover:underline">
                    {a.ticketTitle || a.ticketId}
                  </a>
                ) : null}
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-muted-ink">
                    {(a.sizeBytes / 1024).toFixed(1)} KB · {a.uploaderName || "—"} ·{" "}
                    {a.uploadedAt ? formatDate(a.uploadedAt, lang) : "—"}
                  </p>
                  <Form method="post">
                    <input type="hidden" name="intent" value={a.id ? "delete" : "delete_key"} />
                    {a.id ? (
                      <input type="hidden" name="attachmentId" value={a.id} />
                    ) : (
                      <input type="hidden" name="fileKey" value={a.fileKey} />
                    )}
                    <button
                      type="submit"
                      className="h-10 rounded-full border border-[#F3C9B0] bg-white px-4 text-xs font-semibold text-[#B4541A] hover:bg-[#FDE7DA]"
                    >
                      {t("admin_attachments_delete")}
                    </button>
                  </Form>
                </div>
              </div>
            ))
          )}
        </div>
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm min-w-[960px]">
            <thead>
              <tr className="border-b border-line-soft text-xs font-medium text-muted-ink">
                <th className="text-left px-5 py-3">
                  {t("admin_attachments_col_status")}
                </th>
                <th className="text-left px-5 py-3">
                  {t("admin_attachments_col_file")}
                </th>
                <th className="text-left px-5 py-3">
                  {t("admin_attachments_col_ticket")}
                </th>
                <th className="text-left px-5 py-3">
                  {t("admin_attachments_col_reply")}
                </th>
                <th className="text-left px-5 py-3">
                  {t("admin_attachments_col_uploader")}
                </th>
                <th className="text-left px-5 py-3">
                  {t("admin_attachments_col_date")}
                </th>
                <th className="text-right px-5 py-3">
                  {t("admin_attachments_col_actions")}
                </th>
              </tr>
            </thead>
            <tbody>
              {attachments.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-10 text-center text-muted-ink">
                    {t("admin_attachments_empty")}
                  </td>
                </tr>
              ) : (
                attachments.map((a) => (
                  <tr
                    key={a.fileKey}
                    className={`border-t border-line-soft hover:bg-paper ${
                      a.status === "temporary" ? "bg-[#FFF8CC]/50" : ""
                    }`}
                  >
                    <td className="px-5 py-3.5">
                      <StatusBadge status={a.status} t={t} />
                      {a.missingFromStorage ? (
                        <p className="text-[10px] text-[#B4541A] mt-1">
                          {t("admin_attachments_missing_storage")}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-5 py-3.5">
                      {a.status === "linked" && !a.missingFromStorage ? (
                        <a
                          href={`/api/attachments/${encodeURIComponent(a.fileKey)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 text-ink-soft hover:text-ink"
                        >
                          <FaPaperclip aria-hidden="true" />
                          <span>{a.fileName}</span>
                        </a>
                      ) : (
                        <span className="inline-flex items-center gap-2 text-ink-soft">
                          <FaPaperclip aria-hidden="true" />
                          <span>{a.fileName}</span>
                        </span>
                      )}
                      <p className="text-[11px] text-muted-ink mt-1 font-mono truncate max-w-[220px]">
                        {a.fileKey}
                      </p>
                      <p className="text-[11px] text-muted-ink">
                        {(a.sizeBytes / 1024).toFixed(1)} KB
                      </p>
                    </td>
                    <td className="px-5 py-3.5 text-ink-soft">
                      {a.ticketId ? (
                        <a
                          href={`/admin/tickets/${a.ticketId}`}
                          className="font-medium text-ink underline-offset-4 hover:underline"
                        >
                          {a.ticketTitle || a.ticketId}
                        </a>
                      ) : (
                        <span className="text-faint-ink">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      {a.status === "linked" && a.messageId && a.messageText ? (
                        <a
                          href={`/admin/tickets/${a.ticketId}#msg-${a.messageId}`}
                          className="text-xs text-muted-ink underline-offset-4 hover:text-ink hover:underline"
                        >
                          {a.messageText.slice(0, 70)}
                        </a>
                      ) : a.status === "temporary" ? (
                        <span className="text-xs text-[#6B5B00] italic">
                          {t("admin_attachments_not_sent")}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-ink">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-muted-ink">{a.uploaderName || "—"}</td>
                    <td className="px-5 py-3.5 text-muted-ink">
                      {a.uploadedAt ? formatDate(a.uploadedAt, lang) : "—"}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <Form method="post">
                        <input
                          type="hidden"
                          name="intent"
                          value={a.id ? "delete" : "delete_key"}
                        />
                        {a.id ? (
                          <input type="hidden" name="attachmentId" value={a.id} />
                        ) : (
                          <input type="hidden" name="fileKey" value={a.fileKey} />
                        )}
                        <button
                          type="submit"
                          className="h-8 rounded-full border border-[#F3C9B0] bg-white px-2.5 text-xs font-medium text-[#B4541A] hover:bg-[#FDE7DA]"
                        >
                          {t("admin_attachments_delete")}
                        </button>
                      </Form>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <Pagination page={page} totalPages={totalPages} />
      </div>
    </div>
  );
}
