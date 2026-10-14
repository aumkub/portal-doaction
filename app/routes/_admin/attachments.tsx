import { Form, useNavigation } from "react-router";
import { ConfirmButton } from "~/components/ui/confirm-button";
import { requireAdmin } from "~/lib/auth.server";
import {
  listAllStorageAttachments,
  listTemporaryAttachmentKeys,
  type AttachmentStorageItem,
} from "~/lib/attachments.server";
import { createDB } from "~/lib/db.server";
import { formatDate } from "~/lib/utils";
import { useT } from "~/lib/i18n";
import type { IconType } from "react-icons";
import { FaFile, FaFilePdf, FaImage, FaPaperclip, FaTrash, FaVideo } from "react-icons/fa6";
import Pagination from "~/components/ui/Pagination";

export function meta() {
  return [{ title: "ไฟล์แนบ — Admin" }];
}

const PAGE_SIZE = 20;

// ── File kinds ───────────────────────────────────────────────────────────────

type Kind = "image" | "video" | "pdf" | "other";

const KINDS: Record<Kind, { th: string; en: string; icon: IconType; chip: string }> = {
  image: { th: "รูปภาพ", en: "Images", icon: FaImage, chip: "bg-sky-50 text-sky-700" },
  video: { th: "วิดีโอ", en: "Videos", icon: FaVideo, chip: "bg-[#F1ECFF] text-[#5B3FB0]" },
  pdf: { th: "PDF", en: "PDF", icon: FaFilePdf, chip: "bg-[#FDE7DA] text-[#B4541A]" },
  other: { th: "อื่นๆ", en: "Other", icon: FaFile, chip: "bg-paper text-ink-soft" },
};

function kindOf(mime: string | null | undefined, name: string): Kind {
  const m = (mime || "").toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  if (m === "application/pdf" || /\.pdf$/i.test(name)) return "pdf";
  return "other";
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export async function loader({ request, context }: any) {
  const env = context.cloudflare.env;
  await requireAdmin(request, env.DB, env.SESSIONPORTAL);
  const db = createDB(env.DB);
  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1"));
  const catParam = url.searchParams.get("cat");
  const cat = catParam && catParam in KINDS ? (catParam as Kind) : null;
  const tempOnly = url.searchParams.get("status") === "temporary";

  const all = await listAllStorageAttachments(env.ATTACHMENTS, db);
  const temporaryCount = all.filter((a) => a.status === "temporary").length;
  const counts = { all: all.length } as Record<Kind | "all", number>;
  const sizes = { all: 0 } as Record<Kind | "all", number>;
  for (const k of Object.keys(KINDS) as Kind[]) {
    counts[k] = 0;
    sizes[k] = 0;
  }
  for (const a of all) {
    const k = kindOf(a.mimeType, a.fileName);
    counts[k]++;
    sizes[k] += a.sizeBytes || 0;
    sizes.all += a.sizeBytes || 0;
  }

  const filtered = all.filter(
    (a) => (!cat || kindOf(a.mimeType, a.fileName) === cat) && (!tempOnly || a.status === "temporary")
  );
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const attachments = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  return { attachments, temporaryCount, page: safePage, totalPages, total, counts, sizes, cat, tempOnly };
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

function dayLabel(unix: number, lang: "th" | "en"): string {
  const bkk = (s: number) => new Date((s + 7 * 3600) * 1000).toISOString().slice(0, 10);
  const today = bkk(Math.floor(Date.now() / 1000));
  const yesterday = bkk(Math.floor(Date.now() / 1000) - 86400);
  const d = bkk(unix);
  if (d === today) return lang === "en" ? "Today" : "วันนี้";
  if (d === yesterday) return lang === "en" ? "Yesterday" : "เมื่อวาน";
  return formatDate(unix, lang);
}

function timeLabel(unix: number): string {
  return new Date((unix + 7 * 3600) * 1000).toISOString().slice(11, 16);
}

function filterHref(cat: Kind | null, tempOnly: boolean): string {
  const p = new URLSearchParams();
  if (cat) p.set("cat", cat);
  if (tempOnly) p.set("status", "temporary");
  const qs = p.toString();
  return `/admin/attachments${qs ? `?${qs}` : ""}`;
}

function StatusPill({ status, t }: { status: AttachmentStorageItem["status"]; t: (k: string) => string }) {
  return status === "temporary" ? (
    <span className="rounded-full bg-[#FFF6C2] px-2 py-0.5 text-[11px] font-semibold text-[#6B5B00]">
      {t("admin_attachments_status_temporary")}
    </span>
  ) : (
    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
      {t("admin_attachments_status_linked")}
    </span>
  );
}

export default function AdminAttachmentsPage({ loaderData }: any) {
  const { attachments, temporaryCount, page, totalPages, total, counts, sizes, cat, tempOnly } = loaderData as {
    attachments: AttachmentStorageItem[];
    temporaryCount: number;
    page: number;
    totalPages: number;
    total: number;
    counts: Record<Kind | "all", number>;
    sizes: Record<Kind | "all", number>;
    cat: Kind | null;
    tempOnly: boolean;
  };
  const { t, lang } = useT();
  const L = (th: string, en: string) => (lang === "en" ? en : th);
  const navigation = useNavigation();
  const isClearing = navigation.state !== "idle" && navigation.formData?.get("intent") === "clear_temporary";

  const groups: { day: string; rows: AttachmentStorageItem[] }[] = [];
  for (const a of attachments) {
    const day = a.uploadedAt ? dayLabel(a.uploadedAt, lang) : "—";
    const last = groups[groups.length - 1];
    if (last?.day === day) last.rows.push(a);
    else groups.push({ day, rows: [a] });
  }

  const extra = new URLSearchParams();
  if (cat) extra.set("cat", cat);
  if (tempOnly) extra.set("status", "temporary");

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div>
        <p className="text-sm text-muted-ink">{t("nav_attachments")}</p>
        <h1 className="mt-1.5 text-[28px] md:text-[32px] font-bold tracking-[-0.02em] text-ink">
          {temporaryCount > 0
            ? L(`ไฟล์ชั่วคราว ${temporaryCount} ไฟล์ ควรลบ`, `${temporaryCount} temporary files should be removed`)
            : L(
                `ไฟล์แนบ ${counts.all} ไฟล์ รวม ${formatSize(sizes.all)}`,
                `${counts.all} files, ${formatSize(sizes.all)} in total`
              )}
        </h1>
        {temporaryCount > 0 ? (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <p className="text-sm text-muted-ink">
              {t("admin_attachments_temporary_hint", { count: String(temporaryCount) })}
            </p>
            <Form method="post">
              <input type="hidden" name="intent" value="clear_temporary" />
              <ConfirmButton
                disabled={isClearing}
                destructive
                confirmLabel={t("admin_attachments_clear_all")}
                message={`ลบไฟล์ชั่วคราว ${temporaryCount} ไฟล์ออกจากที่เก็บถาวร ไม่สามารถกู้คืนได้`}
                className="inline-flex h-9 items-center gap-2 rounded-full bg-brand-yellow px-3.5 text-[13px] font-semibold text-ink hover:brightness-95 disabled:opacity-60"
              >
                <FaTrash aria-hidden="true" className="text-xs" />
                {isClearing ? t("admin_attachments_clearing") : t("admin_attachments_clear_all")}
              </ConfirmButton>
            </Form>
          </div>
        ) : null}
      </div>

      {/* ── Type filter ── */}
      <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-5">
        <a
          href={filterHref(null, tempOnly)}
          aria-current={!cat ? "page" : undefined}
          className={`w-[148px] shrink-0 rounded-[18px] border p-4 transition-colors sm:w-auto sm:min-w-0 ${
            !cat ? "border-ink bg-ink text-white" : "border-line bg-white hover:border-ink/30"
          }`}
        >
          <span className={`text-[13px] font-semibold ${!cat ? "text-white" : "text-ink"}`}>{L("ทั้งหมด", "All")}</span>
          <span className="mt-2 block font-display text-[28px] leading-none font-bold tabular-nums">{counts.all}</span>
          <span className={`mt-1.5 block text-xs ${!cat ? "text-white/70" : "text-muted-ink"}`}>{formatSize(sizes.all)}</span>
        </a>
        {(Object.keys(KINDS) as Kind[]).map((k) => {
          const info = KINDS[k];
          const active = cat === k;
          return (
            <a
              key={k}
              href={filterHref(active ? null : k, tempOnly)}
              aria-current={active ? "page" : undefined}
              className={`w-[148px] shrink-0 rounded-[18px] border bg-white p-4 transition-colors sm:w-auto sm:min-w-0 ${
                active ? "border-ink ring-1 ring-ink" : "border-line hover:border-ink/30"
              }`}
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] ${info.chip}`}>
                  <info.icon className="text-[12px]" aria-hidden="true" />
                </span>
                <span className="truncate text-[13px] font-semibold text-ink">{lang === "en" ? info.en : info.th}</span>
              </span>
              <span className="mt-2 block font-display text-[28px] leading-none font-bold tabular-nums text-ink">
                {counts[k]}
              </span>
              <span className="mt-1.5 block text-xs text-muted-ink">{formatSize(sizes[k])}</span>
            </a>
          );
        })}
      </div>

      {/* ── List ── */}
      <section className="overflow-hidden rounded-[20px] border border-line bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-soft px-5 py-3.5">
          <p className="text-sm text-muted-ink">
            {cat ? (lang === "en" ? KINDS[cat].en : KINDS[cat].th) : L("ทุกประเภท", "All types")} ·{" "}
            {L(`${total} ไฟล์`, `${total} files`)}
          </p>
          <div className="inline-flex rounded-full bg-paper p-[3px]">
            {[
              { v: false, label: L("ทั้งหมด", "All") },
              { v: true, label: L(`ชั่วคราว (${temporaryCount})`, `Temporary (${temporaryCount})`) },
            ].map((o) => (
              <a
                key={String(o.v)}
                href={filterHref(cat, o.v)}
                className={`flex h-8 items-center rounded-full px-3.5 text-[13px] font-medium ${
                  tempOnly === o.v ? "bg-white text-ink shadow-[0_1px_2px_rgba(0,0,0,0.08)]" : "text-muted-ink hover:text-ink"
                }`}
              >
                {o.label}
              </a>
            ))}
          </div>
        </div>

        {attachments.length === 0 ? (
          <div className="px-5 py-14 text-center">
            <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-paper text-ink-soft">
              <FaPaperclip />
            </span>
            <p className="text-sm text-muted-ink">{t("admin_attachments_empty")}</p>
          </div>
        ) : (
          groups.map((g) => (
            <div key={g.day}>
              <p className="sticky top-0 z-[1] border-b border-line-soft bg-paper/80 px-5 py-2 text-xs font-semibold text-muted-ink backdrop-blur">
                {g.day}
              </p>
              <ul className="divide-y divide-[#F4F2EC]">
                {g.rows.map((a) => {
                  const info = KINDS[kindOf(a.mimeType, a.fileName)];
                  const canOpen = a.status === "linked" && !a.missingFromStorage;
                  const inner = (
                    <>
                      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] ${info.chip}`}>
                        <info.icon className="text-sm" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-ink">{a.fileName}</span>
                        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-ink">
                          <span className="shrink-0 font-medium text-ink-soft">{formatSize(a.sizeBytes)}</span>
                          <span aria-hidden="true">·</span>
                          <span className="truncate">
                            {a.ticketTitle || a.ticketId || (a.status === "temporary" ? t("admin_attachments_not_sent") : "—")}
                            {a.uploaderName ? ` · ${a.uploaderName}` : ""}
                          </span>
                        </span>
                        {a.missingFromStorage ? (
                          <span className="mt-0.5 block text-[11px] text-[#B4541A]">{t("admin_attachments_missing_storage")}</span>
                        ) : null}
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-1">
                        <span className="text-xs tabular-nums text-faint-ink">{a.uploadedAt ? timeLabel(a.uploadedAt) : "—"}</span>
                        <StatusPill status={a.status} t={t} />
                      </span>
                    </>
                  );
                  return (
                    <li key={a.fileKey} className={`flex items-center gap-2 pr-3 ${a.status === "temporary" ? "bg-[#FFF8CC]/40" : ""}`}>
                      {canOpen ? (
                        <a
                          href={`/api/attachments/${encodeURIComponent(a.fileKey)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex min-w-0 flex-1 items-center gap-3.5 py-3.5 pl-5 text-left hover:bg-paper/60"
                        >
                          {inner}
                        </a>
                      ) : (
                        <div className="flex min-w-0 flex-1 items-center gap-3.5 py-3.5 pl-5">{inner}</div>
                      )}
                      <Form method="post" className="shrink-0">
                        <input type="hidden" name="intent" value={a.id ? "delete" : "delete_key"} />
                        {a.id ? (
                          <input type="hidden" name="attachmentId" value={a.id} />
                        ) : (
                          <input type="hidden" name="fileKey" value={a.fileKey} />
                        )}
                        <ConfirmButton
                          aria-label={t("admin_attachments_delete")}
                          title={t("admin_attachments_delete")}
                          destructive
                          confirmLabel={t("admin_attachments_delete")}
                          message={`ลบไฟล์นี้ถาวร ไม่สามารถกู้คืนได้`}
                          className="flex h-9 w-9 items-center justify-center rounded-full text-faint-ink hover:bg-[#FDE7DA] hover:text-[#B4541A]"
                        >
                          <FaTrash className="text-xs" aria-hidden="true" />
                        </ConfirmButton>
                      </Form>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
        <Pagination page={page} totalPages={totalPages} extra={extra.toString() || undefined} />
      </section>
    </div>
  );
}
