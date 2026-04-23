import { Form, redirect, useActionData, type FormEvent } from "react-router";
import { z } from "zod";
import { useState, type FormEvent as ReactFormEvent } from "react";
import { requireCoAdminOrAdmin, startImpersonation, generateMagicToken } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";
import { generateId } from "~/lib/utils";
import { useT } from "~/lib/i18n";
import { sendTelegramNotificationForClient } from "~/lib/telegram.server";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Button } from "~/components/ui/button";
import { FaTrash } from "react-icons/fa6";
import {
  normalizeClientCcEmailsInput,
  parseClientCcEmails,
  stringifyClientCcEmails,
} from "~/lib/client-cc";

export function meta() {
  return [{ title: "รายละเอียดลูกค้า — Admin" }];
}

const UpdateSchema = z.object({
  name: z.string().min(1, "กรุณาระบุชื่อ"),
  company_name: z.string().min(1, "กรุณาระบุชื่อบริษัท"),
  website_url: z.string().url("URL ไม่ถูกต้อง").optional().or(z.literal("")),
  package: z.enum(["basic", "standard", "premium"]),
  contract_start: z.string().optional(),
  contract_end: z.string().optional(),
  notes: z.string().optional(),
  cc_emails: z.string().optional(),
});

export async function loader({ request, params, context }: any) {
  const env = context.cloudflare.env;
  const currentUser = await requireCoAdminOrAdmin(request, env.DB, env.SESSIONPORTAL);
  const db = createDB(env.DB);

  const client = await db.getClientById(params.clientId);
  if (!client) throw new Response("Not Found", { status: 404 });

  // For Co-Admins, verify they have access to this client
  let canImpersonate = false;
  if (currentUser.role === "co-admin") {
    const assignments = await db.listCoAdminClients(currentUser.id);
    const assignedClientIds = assignments.map((a) => a.client_id);
    if (!assignedClientIds.includes(client.id)) {
      throw new Response("You don't have access to this client", { status: 403 });
    }
  } else if (currentUser.role === "admin") {
    canImpersonate = true; // Only admins can impersonate clients
  }

  const user = await db.getUserById(client.user_id);
  const [reports, tickets, notes] = await Promise.all([
    db.listReportsByClient(client.id),
    db.listTicketsByClient(client.id),
    db.listCustomerNotes(client.id),
  ]);

  return { client, user, reportsCount: reports.length, ticketsCount: tickets.length, notes, currentUser, canImpersonate };
}

export async function action({ request, params, context }: any) {
  const env = context.cloudflare.env;
  const currentUser = await requireCoAdminOrAdmin(request, env.DB, env.SESSIONPORTAL);
  const db = createDB(env.DB);
  const client = await db.getClientById(params.clientId);
  if (!client) throw new Response("Not Found", { status: 404 });

  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  // Co-Admins can only add or delete notes - reject all other intents
  if (currentUser.role === "co-admin" && intent !== "add_note" && intent !== "delete_note") {
    throw new Response("Forbidden", { status: 403 });
  }

  if (intent === "update_client") {
    const parsed = UpdateSchema.safeParse(Object.fromEntries(formData));
    const noContractEnd = formData.get("no_contract_end") === "1";

    if (!parsed.success) {
      return {
        errors: parsed.error.flatten().fieldErrors,
        noContractEnd,
        values: {
          name: String(formData.get("name") ?? ""),
          company_name: String(formData.get("company_name") ?? ""),
          website_url: String(formData.get("website_url") ?? ""),
          package: String(formData.get("package") ?? "standard"),
          contract_start: String(formData.get("contract_start") ?? ""),
          contract_end: String(formData.get("contract_end") ?? ""),
          notes: String(formData.get("notes") ?? ""),
          cc_emails: String(formData.get("cc_emails") ?? ""),
        },
      };
    }

    const { name, company_name, website_url, package: pkg, contract_start, contract_end, notes, cc_emails } =
      parsed.data;
    const normalizedCcEmails = normalizeClientCcEmailsInput(cc_emails);
    if (normalizedCcEmails.error) {
      return {
        errors: { cc_emails: [normalizedCcEmails.error] },
        noContractEnd,
        values: {
          name,
          company_name,
          website_url: website_url ?? "",
          package: pkg,
          contract_start: contract_start ?? "",
          contract_end: contract_end ?? "",
          notes: notes ?? "",
          cc_emails: cc_emails ?? "",
        },
      };
    }
    const user = await db.getUserById(client.user_id);
    if (!user) throw new Response("Not Found", { status: 404 });

    await db.updateUser(client.user_id, { name });
    await db.updateClient(client.id, {
      company_name,
      website_url: website_url || null,
      package: pkg,
      contract_start: contract_start || null,
      contract_end: noContractEnd ? null : contract_end || null,
      notes: notes || null,
      cc_emails: stringifyClientCcEmails(normalizedCcEmails.emails),
    });

    return redirect(`/admin/clients/${params.clientId}`);
  }

  if (intent === "update_email") {
    const newEmail = String(formData.get("email") ?? "").trim().toLowerCase();
    if (!newEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
      return { errors: { email: ["อีเมลไม่ถูกต้อง / Invalid email"] } };
    }
    const existing = await db.getUserByEmail(newEmail);
    if (existing && existing.id !== client.user_id) {
      return { errors: { email: ["admin_change_email_duplicate"] }, emailDuplicate: true };
    }
    await db.updateUser(client.user_id, { email: newEmail });
    return { success: { email_changed: true, email: newEmail } };
  }

  if (intent === "send_magic_link") {
    const user = await db.getUserById(client.user_id);
    if (!user?.email) throw new Response("No email", { status: 400 });

    const { id, token, expires_at } = generateMagicToken();
    await db.createMagicLinkToken({ id, user_id: user.id, token, expires_at, used: 0 });

    const origin = env.APP_URL || new URL(request.url).origin;
    const magicUrl = `${origin}/magic-link?token=${token}`;

    if (env.SEND_EMAIL) {
      const { sendMagicLinkEmail } = await import("~/lib/email.server");
      context.cloudflare.ctx.waitUntil(
        sendMagicLinkEmail({
          to: user.email,
          toName: user.name,
          magicUrl,
          sendEmail: env.SEND_EMAIL,
          db,
          source: "admin_send_magic_link",
          lang: user.language === "en" ? "en" : "th",
        }).catch(console.error)
      );
    }

    return { success: { magic_link: true, email: user.email } };
  }

  if (intent === "impersonate") {
    // Only admins can impersonate clients
    if (currentUser.role !== "admin") {
      return { errors: { general: ["You don't have permission to impersonate clients"] } };
    }

    const sessionCookie = await startImpersonation(
      request,
      env.DB,
      env.SESSIONPORTAL,
      client.user_id,
      currentUser.id
    );

    return redirect("/dashboard", {
      headers: { "Set-Cookie": sessionCookie.serialize() },
    });
  }

  if (intent === "delete_client") {
    await db.softDeleteClient(client.id);
    return redirect("/admin/clients");
  }

  if (intent === "add_note") {
    const note = String(formData.get("note") ?? "").trim();
    if (!note) {
      return { errors: { note: ["กรุณาระบุข้อความ"] } };
    }

    await db.createCustomerNote({
      id: generateId(),
      client_id: client.id,
      user_id: currentUser.id,
      note,
    });

    // Send Telegram notification to co-admin groups or default group
    const appUrl = env.APP_URL || new URL(request.url).origin;
    context.cloudflare.ctx.waitUntil(
      sendTelegramNotificationForClient({
        db,
        appUrl,
        notification: {
          title: `📝 Internal Note Added - ${client.company_name}`,
          body: `${currentUser.name} (${currentUser.role}) added a note:\n\n${note.substring(0, 200)}${note.length > 200 ? '...' : ''}`,
          link: `/admin/clients/${client.id}`,
        },
        clientId: client.id,
      }).catch(console.error)
    );

    return { success: { note_added: true } };
  }

  if (intent === "delete_note") {
    const noteId = String(formData.get("note_id") ?? "");
    const note = await db.getCustomerNoteById(noteId);

    if (!note) {
      return { errors: { general: ["Note not found"] } };
    }

    // Only admins, co-admins, or the note creator can delete
    if (currentUser.role !== "admin" && currentUser.role !== "co-admin" && note.user_id !== currentUser.id) {
      return { errors: { general: ["You don't have permission to delete this note"] } };
    }

    await db.deleteCustomerNote(noteId);
    return { success: { note_deleted: true } };
  }

  throw new Response("Bad Request", { status: 400 });
}

type ActionData = {
  errors?: Record<string, string[] | undefined>;
  noContractEnd?: boolean;
  values?: {
    name: string;
    company_name: string;
    website_url: string;
    package: string;
    contract_start: string;
    contract_end: string;
    notes: string;
    cc_emails: string;
  };
  emailDuplicate?: boolean;
  success?:
    | { magic_link: true; email: string }
    | { email_changed: true; email: string }
    | { note_added: true }
    | { note_deleted: true };
};

const PKG_BADGE: Record<string, string> = {
  basic: "bg-slate-100 text-slate-600",
  standard: "bg-blue-100 text-blue-700",
  premium: "bg-violet-100 text-violet-700",
};

export default function AdminClientDetailPage({ loaderData }: any) {
  const { client, user, reportsCount, ticketsCount, notes, currentUser, canImpersonate } = loaderData;
  const { t } = useT();
  const actionData = useActionData() as ActionData | undefined;
  const isViewOnly = currentUser.role === "co-admin";

  const v =
    actionData?.values ?? {
      name: user?.name ?? "",
      company_name: client.company_name,
      website_url: client.website_url ?? "",
      package: client.package,
      contract_start: client.contract_start ?? "",
      contract_end: client.contract_end ?? "",
      notes: client.notes ?? "",
      cc_emails: parseClientCcEmails(client.cc_emails).join(", "),
    };

  const errors = actionData?.errors;
  const noContractEndInitial =
    actionData?.noContractEnd !== undefined
      ? actionData.noContractEnd
      : !client.contract_end;

  const [noContractEnd, setNoContractEnd] = useState(noContractEndInitial);
  const formKey = `${client.id}-${actionData?.errors ? "err" : "ok"}`;

  const emailChanged = actionData?.success && "email_changed" in actionData.success;
  const magicLinkSent = actionData?.success && "magic_link" in actionData.success;
  const noteAdded = actionData?.success && "note_added" in actionData.success;
  const currentEmail = emailChanged
    ? (actionData!.success as any).email
    : user?.email ?? "";

  return (
    <div className="grid grid-cols-12 max-w-6xl gap-6 space-y-5">
      <div className="flex gap-6 col-span-8">
        {/* Main column */}
        <div className="flex-1 space-y-5">

      {/* ── Header ── */}
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <a href="/admin/clients" className="text-xs text-slate-400 hover:text-slate-700 transition-colors">
            ← {t("admin_back_clients")}
          </a>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-semibold text-slate-900">{client.company_name}</h1>
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full capitalize ${PKG_BADGE[client.package] ?? PKG_BADGE.standard}`}>
              {t(`admin_pkg_${client.package}` as any)}
            </span>
          </div>
          {/* Identity meta row */}
          <div className="flex items-center gap-3 text-xs text-slate-500 flex-wrap">
            <span>{user?.name ?? "—"}</span>
            <span className="text-slate-300">·</span>
            <span>{currentEmail || "—"}</span>
            {client.website_url && (
              <>
                <span className="text-slate-300">·</span>
                <a
                  href={client.website_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-violet-600 hover:underline truncate max-w-[180px]"
                >
                  {client.website_url.replace(/^https?:\/\//, "")}
                </a>
              </>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="flex gap-3 shrink-0">
          <div className="text-center bg-white border border-slate-200 rounded-xl px-5 py-3">
            <p className="text-2xl font-semibold text-slate-900">{reportsCount}</p>
            <p className="text-xs text-slate-400 mt-0.5">{t("admin_reports_total")}</p>
          </div>
          <div className="text-center bg-white border border-slate-200 rounded-xl px-5 py-3">
            <p className="text-2xl font-semibold text-slate-900">{ticketsCount}</p>
            <p className="text-xs text-slate-400 mt-0.5">{t("admin_tickets_total_label")}</p>
          </div>
        </div>
      </div>

      {/* ── Edit client form ── */}
      <Form
        method="post"
        key={formKey}
        className="bg-white rounded-xl border border-slate-200 p-5 space-y-4"
      >
        <input type="hidden" name="intent" value="update_client" />
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">{t("admin_client_edit_heading")}</h2>
          {isViewOnly && (
            <span className="text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded-full font-medium">
              {t("view_only")}
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="name">{t("admin_client_new_name")}</Label>
            <Input id="name" name="name" defaultValue={v.name} required disabled={isViewOnly} className={isViewOnly ? "bg-slate-50 text-slate-500" : ""} />
            {errors?.name && <p className="text-red-500 text-xs">{errors.name[0]}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="company_name">{t("admin_client_new_company_name")}</Label>
            <Input id="company_name" name="company_name" defaultValue={v.company_name} required disabled={isViewOnly} className={isViewOnly ? "bg-slate-50 text-slate-500" : ""} />
            {errors?.company_name && <p className="text-red-500 text-xs">{errors.company_name[0]}</p>}
          </div>
          <div className="space-y-1.5 col-span-2">
            <Label htmlFor="website_url">{t("admin_client_new_website")}</Label>
            <Input
              id="website_url"
              name="website_url"
              type="url"
              defaultValue={v.website_url}
              placeholder="https://example.com"
              disabled={isViewOnly}
              className={isViewOnly ? "bg-slate-50 text-slate-500" : ""}
            />
            {errors?.website_url && <p className="text-red-500 text-xs">{errors.website_url[0]}</p>}
          </div>
          <div className="space-y-1.5 col-span-2">
            <Label htmlFor="cc_emails">CC Email (สูงสุด 5)</Label>
            <textarea
              id="cc_emails"
              name="cc_emails"
              rows={2}
              defaultValue={v.cc_emails}
              placeholder="cc1@example.com, cc2@example.com"
              disabled={isViewOnly}
              className={`w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 resize-none ${isViewOnly ? "bg-slate-50 text-slate-500" : ""}`}
            />
            <p className="text-xs text-slate-500">คั่นด้วย comma หรือขึ้นบรรทัดใหม่</p>
            {errors?.cc_emails && <p className="text-red-500 text-xs">{errors.cc_emails[0]}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="package">{t("settings_package_label")}</Label>
            <select
              id="package"
              name="package"
              defaultValue={v.package}
              disabled={isViewOnly}
              className={`w-full h-10 rounded-lg border border-slate-200 px-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-900 ${isViewOnly ? "bg-slate-50 text-slate-500" : ""}`}
            >
              <option value="basic">{t("admin_pkg_basic")}</option>
              <option value="standard">{t("admin_pkg_standard")}</option>
              <option value="premium">{t("admin_pkg_premium")}</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="contract_start">{t("admin_client_new_contract_start")}</Label>
            <Input id="contract_start" name="contract_start" type="date" defaultValue={v.contract_start} disabled={isViewOnly} className={isViewOnly ? "bg-slate-50 text-slate-500" : ""} />
          </div>
          <div className="space-y-1.5 col-span-2">
            <Label htmlFor="contract_end">{t("admin_client_new_contract_end")}</Label>
            <Input
              id="contract_end"
              name="contract_end"
              type="date"
              defaultValue={v.contract_end}
              disabled={noContractEnd || isViewOnly}
              className={isViewOnly ? "bg-slate-50 text-slate-500" : ""}
            />
            <label className="mt-2 inline-flex items-center gap-2 text-xs text-slate-600">
              <input
                type="checkbox"
                name="no_contract_end"
                value="1"
                checked={noContractEnd}
                onChange={(e) => setNoContractEnd(e.target.checked)}
                disabled={isViewOnly}
                className="rounded accent-violet-600"
              />
              {t("admin_client_new_monthly_no_end")}
            </label>
          </div>
          <div className="space-y-1.5 col-span-2">
            <Label htmlFor="notes">{t("admin_client_new_notes")}</Label>
            <textarea
              id="notes"
              name="notes"
              rows={2}
              defaultValue={v.notes}
              disabled={isViewOnly}
              className={`w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 resize-none ${isViewOnly ? "bg-slate-50 text-slate-500" : ""}`}
            />
          </div>
        </div>

        {!isViewOnly && (
          <div className="flex justify-end pt-1">
            <Button type="submit" className="bg-violet-600 hover:bg-violet-700 text-white">
              {t("save")}
            </Button>
          </div>
        )}
      </Form>

      {/* ── Account Access (change email + magic link) ── */}
      {!isViewOnly && (
        <div className="grid grid-cols-2 gap-4">
        {/* Change Email */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
          <div>
            <p className="text-sm font-semibold text-slate-900">{t("admin_change_email_title")}</p>
            <p className="text-xs text-slate-500 mt-0.5">{t("admin_change_email_desc")}</p>
          </div>
          {emailChanged && (
            <p className="text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
              ✓ {t("admin_change_email_success")} — {(actionData!.success as any).email}
            </p>
          )}
          {errors?.email && (
            <p className="text-xs font-medium text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
              {actionData?.emailDuplicate ? t("admin_change_email_duplicate") : errors.email[0]}
            </p>
          )}
          <Form method="post" className="space-y-2">
            <input type="hidden" name="intent" value="update_email" />
            <Input
              name="email"
              type="email"
              defaultValue={currentEmail}
              required
              placeholder="email@example.com"
            />
            <Button type="submit" className="w-full bg-slate-900 hover:bg-slate-700 text-white text-sm">
              {t("admin_change_email_btn")}
            </Button>
          </Form>
        </div>

        {/* Send Magic Link */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
          <div>
            <p className="text-sm font-semibold text-slate-900">{t("admin_send_magic_link_title")}</p>
            <p className="text-xs text-slate-500 mt-0.5">{t("admin_send_magic_link_desc")}</p>
          </div>
          {magicLinkSent && (
            <p className="text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
              ✓ {t("admin_send_magic_link_success")} — {(actionData!.success as any).email}
            </p>
          )}
          <Form method="post">
            <input type="hidden" name="intent" value="send_magic_link" />
            <Button type="submit" className="w-full bg-violet-600 hover:bg-violet-700 text-white text-sm">
              {t("admin_send_magic_link_btn")}
            </Button>
          </Form>
        </div>
      </div>
      )}

      {/* ── Impersonate ── */}
      {canImpersonate && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-amber-900">{t("admin_impersonate_title")}</p>
            <p className="text-xs text-amber-800 mt-0.5">{t("admin_impersonate_desc")}</p>
          </div>
          <Form method="post" className="shrink-0">
            <input type="hidden" name="intent" value="impersonate" />
            <button
              type="submit"
              className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 transition-colors whitespace-nowrap"
            >
              {t("admin_impersonate_btn")}
            </button>
          </Form>
        </div>
      )}

      {/* ── Danger zone ── */}
      {!isViewOnly && (
        <div className="bg-rose-50 border border-rose-200 rounded-xl p-5 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-rose-900">{t("admin_client_delete_title")}</p>
            <p className="text-xs text-rose-800 mt-0.5">{t("admin_client_delete_desc")}</p>
          </div>
          <Form
            method="post"
            className="shrink-0"
            onSubmit={(e: ReactFormEvent<HTMLFormElement>) => {
              if (!confirm(t("admin_client_delete_confirm"))) e.preventDefault();
            }}
          >
            <input type="hidden" name="intent" value="delete_client" />
            <button
              type="submit"
              className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 transition-colors"
            >
              {t("admin_client_delete_btn")}
            </button>
          </Form>
        </div>
      )}
        </div>
      </div>

      {/* Sidebar - Internal Notes */}
      <div className="col-span-4">
        <div className="sticky top-6 space-y-5">
          <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-900">บันทึกภายใน (Internal Notes)</p>
                <p className="text-xs text-slate-500 mt-0.5">บันทึกเกี่ยวกับลูกค้า สำหรับ Admin และ Co-Admin</p>
              </div>
              <span className="text-xs text-slate-400">{notes.length} บันทึก</span>
            </div>

            {/* Add note form */}
            <Form method="post" className="space-y-2" key={`note-${notes.length}`}>
              <input type="hidden" name="intent" value="add_note" />
              <textarea
                name="note"
                rows={3}
                placeholder="เพิ่มบันทึกใหม่..."
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 resize-none"
              />
              {actionData?.errors?.note && (
                <p className="text-xs text-red-500">{actionData.errors.note[0]}</p>
              )}
              <div className="flex justify-end">
                <Button
                  type="submit"
                  className="bg-slate-900 hover:bg-slate-700 text-white text-sm"
                >
                  เพิ่มบันทึก
                </Button>
              </div>
            </Form>

            {/* Notes list */}
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {notes.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-4">ยังไม่มีบันทึก</p>
          ) : (
            notes.map((note: any) => {
              const canDelete = currentUser?.role === "admin" || currentUser?.role === "co-admin" || note.user_id === currentUser?.id;
              return (
                <div key={note.id} className="bg-slate-50 rounded-lg p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-medium text-slate-700">{note.user_name}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                          note.user_role === "admin" ? "bg-violet-100 text-violet-700" : "bg-emerald-100 text-emerald-700"
                        }`}>
                          {note.user_role === "admin" ? "Admin" : "Co-Admin"}
                        </span>
                        <span className="text-[10px] text-slate-400">
                          {new Date(note.created_at * 1000).toLocaleString("th-TH")}
                        </span>
                      </div>
                      <p className="text-sm text-slate-700 whitespace-pre-wrap">{note.note}</p>
                    </div>
                    {(currentUser.role === "admin" || currentUser.role === "co-admin" || note.user_id === currentUser.id) && (
                      <Form method="post">
                        <input type="hidden" name="intent" value="delete_note" />
                        <input type="hidden" name="note_id" value={note.id} />
                        <button
                          type="submit"
                          onClick={(e) => {
                            if (!confirm("ลบบันทึกนี้?")) e.preventDefault();
                          }}
                          className="text-slate-400 hover:text-red-600 transition-colors p-1"
                          title="ลบบันทึก"
                        >
                          <FaTrash className="w-4 h-4" />
                        </button>
                      </Form>
                    )}
                  </div>
                </div>
              );
            })
          )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
