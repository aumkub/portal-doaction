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
import {
  FaTrash,
  FaArrowLeft,
  FaFileLines,
  FaTicket,
  FaGlobe,
  FaEnvelope,
  FaUserSecret,
  FaPaperPlane,
  FaCircleCheck,
} from "react-icons/fa6";
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

  let canImpersonate = false;
  if (currentUser.role === "co-admin") {
    const assignments = await db.listCoAdminClients(currentUser.id);
    const assignedClientIds = assignments.map((a: any) => a.client_id);
    if (!assignedClientIds.includes(client.id)) {
      throw new Response("You don't have access to this client", { status: 403 });
    }
  } else if (currentUser.role === "admin") {
    canImpersonate = true;
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

    const { name, company_name, website_url, package: pkg, contract_start, contract_end, notes, cc_emails } = parsed.data;
    const normalizedCcEmails = normalizeClientCcEmailsInput(cc_emails);
    if (normalizedCcEmails.error) {
      return {
        errors: { cc_emails: [normalizedCcEmails.error] },
        noContractEnd,
        values: {
          name, company_name,
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
      const { parseClientCcEmails } = await import("~/lib/client-cc");
      const ccRecipients = parseClientCcEmails(client.cc_emails).map((ccEmail: string) => ({ email: ccEmail }));
      context.cloudflare.ctx.waitUntil(
        sendMagicLinkEmail({
          to: user.email,
          toName: user.name,
          cc: ccRecipients.length > 0 ? ccRecipients : undefined,
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
    if (currentUser.role !== "admin") {
      return { errors: { general: ["You don't have permission to impersonate clients"] } };
    }
    const sessionCookie = await startImpersonation(request, env.DB, env.SESSIONPORTAL, client.user_id, currentUser.id);
    return redirect("/dashboard", { headers: { "Set-Cookie": sessionCookie.serialize() } });
  }

  if (intent === "delete_client") {
    await db.softDeleteClient(client.id);
    return redirect("/admin/clients");
  }

  if (intent === "add_note") {
    const note = String(formData.get("note") ?? "").trim();
    if (!note) return { errors: { note: ["กรุณาระบุข้อความ"] } };

    await db.createCustomerNote({ id: generateId(), client_id: client.id, user_id: currentUser.id, note });

    const appUrl = env.APP_URL || new URL(request.url).origin;
    context.cloudflare.ctx.waitUntil(
      sendTelegramNotificationForClient({
        db, appUrl,
        notification: {
          title: `📝 Internal Note Added - ${client.company_name}`,
          body: `${currentUser.name} (${currentUser.role}) added a note:\n\n${note.substring(0, 200)}${note.length > 200 ? "..." : ""}`,
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
    if (!note) return { errors: { general: ["Note not found"] } };
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
    name: string; company_name: string; website_url: string;
    package: string; contract_start: string; contract_end: string;
    notes: string; cc_emails: string;
  };
  emailDuplicate?: boolean;
  success?:
    | { magic_link: true; email: string }
    | { email_changed: true; email: string }
    | { note_added: true }
    | { note_deleted: true };
};

const packageStyles: Record<string, { badge: string; dot: string; label: string }> = {
  basic:    { badge: "bg-slate-100 text-slate-600 ring-1 ring-slate-200",  dot: "bg-slate-400",  label: "Basic" },
  standard: { badge: "bg-blue-50 text-blue-600 ring-1 ring-blue-200",      dot: "bg-blue-500",   label: "Standard" },
  premium:  { badge: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",   dot: "bg-amber-500",  label: "Premium" },
};

function getInitials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

function avatarColor(name: string) {
  const colors = [
    "bg-violet-100 text-violet-700", "bg-blue-100 text-blue-700",
    "bg-emerald-100 text-emerald-700", "bg-orange-100 text-orange-700",
    "bg-rose-100 text-rose-700", "bg-indigo-100 text-indigo-700",
    "bg-teal-100 text-teal-700", "bg-pink-100 text-pink-700",
  ];
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) & 0xffff;
  return colors[hash % colors.length];
}

function SectionCard({ title, subtitle, children, action }: {
  title: string; subtitle?: string; children: React.ReactNode; action?: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
        <div>
          <p className="text-sm font-semibold text-slate-900">{title}</p>
          {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
        </div>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

export default function AdminClientDetailPage({ loaderData }: any) {
  const { client, user, reportsCount, ticketsCount, notes, currentUser, canImpersonate } = loaderData;
  const { t } = useT();
  const actionData = useActionData() as ActionData | undefined;
  const isViewOnly = currentUser.role === "co-admin";

  const v = actionData?.values ?? {
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
    actionData?.noContractEnd !== undefined ? actionData.noContractEnd : !client.contract_end;
  const [noContractEnd, setNoContractEnd] = useState(noContractEndInitial);
  const formKey = `${client.id}-${actionData?.errors ? "err" : "ok"}`;

  const emailChanged   = actionData?.success && "email_changed" in actionData.success;
  const magicLinkSent  = actionData?.success && "magic_link" in actionData.success;
  const noteAdded      = actionData?.success && "note_added" in actionData.success;
  const currentEmail   = emailChanged ? (actionData!.success as any).email : user?.email ?? "";

  const pkg = packageStyles[client.package] ?? packageStyles.standard;
  const initials = getInitials(client.company_name);
  const avatarCls = avatarColor(client.company_name);

  return (
    <div className="space-y-6">

      {/* ── Breadcrumb ── */}
      <div>
        <a
          href="/admin/clients"
          className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 transition-colors mb-4"
        >
          <FaArrowLeft className="text-[10px]" />
          {t("admin_back_clients")}
        </a>

        {/* Hero header */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex flex-col sm:flex-row sm:items-start gap-4">
            {/* Avatar + identity */}
            <div className="flex items-center gap-4 flex-1 min-w-0">
              <span className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-xl text-lg font-bold ${avatarCls}`}>
                {initials}
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-2.5 flex-wrap">
                  <h1 className="text-xl font-semibold text-slate-900 leading-tight">{client.company_name}</h1>
                  <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${pkg.badge}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${pkg.dot}`} />
                    {t(`admin_pkg_${client.package}` as any)}
                  </span>
                  {isViewOnly && (
                    <span className="text-xs font-medium text-amber-700 bg-amber-50 px-2.5 py-1 rounded-full ring-1 ring-amber-200">
                      {t("view_only")}
                    </span>
                  )}
                </div>
                <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mt-1.5">
                  <span className="text-sm text-slate-500">{user?.name ?? "—"}</span>
                  <span className="text-slate-300 hidden sm:inline">·</span>
                  <span className="flex items-center gap-1 text-sm text-slate-500">
                    <FaEnvelope className="text-[10px] text-slate-500" />
                    {currentEmail || "—"}
                  </span>
                  {client.website_url && (
                    <>
                      <span className="text-slate-300 hidden sm:inline">·</span>
                      <a
                        href={client.website_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-sm text-violet-600 hover:underline underline-offset-2 truncate max-w-[200px]"
                      >
                        <FaGlobe className="text-[10px]" />
                        {client.website_url.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                      </a>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Stats */}
            <div className="flex gap-3 shrink-0">
              <div className="flex items-center gap-3 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white border border-slate-200 text-slate-500">
                  <FaFileLines className="text-xs" />
                </span>
                <div>
                  <p className="text-xl font-semibold text-slate-900 leading-none">{reportsCount}</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">{t("admin_reports_total")}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white border border-slate-200 text-slate-500">
                  <FaTicket className="text-xs" />
                </span>
                <div>
                  <p className="text-xl font-semibold text-slate-900 leading-none">{ticketsCount}</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">{t("admin_tickets_total_label")}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Main 2-column layout ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

        {/* ── Left column ── */}
        <div className="lg:col-span-8 space-y-5">

          {/* Edit form */}
          <Form method="post" key={formKey}>
            <input type="hidden" name="intent" value="update_client" />
            <SectionCard
              title={t("admin_client_edit_heading")}
              action={
                !isViewOnly ? (
                  <Button type="submit" className="bg-slate-900 hover:bg-slate-700 text-white text-xs px-4 h-8">
                    {t("save")}
                  </Button>
                ) : undefined
              }
            >
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="name">{t("admin_client_new_name")}</Label>
                  <Input id="name" name="name" defaultValue={v.name} required disabled={isViewOnly}
                    className={isViewOnly ? "bg-slate-50 text-slate-500" : ""} />
                  {errors?.name && <p className="text-red-500 text-xs">{errors.name[0]}</p>}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="company_name">{t("admin_client_new_company_name")}</Label>
                  <Input id="company_name" name="company_name" defaultValue={v.company_name} required disabled={isViewOnly}
                    className={isViewOnly ? "bg-slate-50 text-slate-500" : ""} />
                  {errors?.company_name && <p className="text-red-500 text-xs">{errors.company_name[0]}</p>}
                </div>
                <div className="space-y-1.5 col-span-2">
                  <Label htmlFor="website_url">{t("admin_client_new_website")}</Label>
                  <Input id="website_url" name="website_url" type="url" defaultValue={v.website_url}
                    placeholder="https://example.com" disabled={isViewOnly}
                    className={isViewOnly ? "bg-slate-50 text-slate-500" : ""} />
                  {errors?.website_url && <p className="text-red-500 text-xs">{errors.website_url[0]}</p>}
                </div>
                <div className="space-y-1.5 col-span-2">
                  <Label htmlFor="cc_emails">CC Email <span className="text-slate-500 font-normal">(สูงสุด 5)</span></Label>
                  <textarea id="cc_emails" name="cc_emails" rows={2} defaultValue={v.cc_emails}
                    placeholder="cc1@example.com, cc2@example.com" disabled={isViewOnly}
                    className={`w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 resize-none transition ${isViewOnly ? "bg-slate-50 text-slate-500" : ""}`} />
                  <p className="text-xs text-slate-500">คั่นด้วย comma หรือขึ้นบรรทัดใหม่</p>
                  {errors?.cc_emails && <p className="text-red-500 text-xs">{errors.cc_emails[0]}</p>}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="package">{t("settings_package_label")}</Label>
                  <select id="package" name="package" defaultValue={v.package} disabled={isViewOnly}
                    className={`w-full h-10 rounded-lg border border-slate-200 px-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-900 transition ${isViewOnly ? "bg-slate-50 text-slate-500" : ""}`}>
                    <option value="basic">{t("admin_pkg_basic")}</option>
                    <option value="standard">{t("admin_pkg_standard")}</option>
                    <option value="premium">{t("admin_pkg_premium")}</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="contract_start">{t("admin_client_new_contract_start")}</Label>
                  <Input id="contract_start" name="contract_start" type="date" defaultValue={v.contract_start}
                    disabled={isViewOnly} className={isViewOnly ? "bg-slate-50 text-slate-500" : ""} />
                </div>
                <div className="space-y-1.5 col-span-2">
                  <Label htmlFor="contract_end">{t("admin_client_new_contract_end")}</Label>
                  <Input id="contract_end" name="contract_end" type="date" defaultValue={v.contract_end}
                    disabled={noContractEnd || isViewOnly}
                    className={(noContractEnd || isViewOnly) ? "bg-slate-50 text-slate-500" : ""} />
                  <label className="mt-2 inline-flex items-center gap-2 text-xs text-slate-600 cursor-pointer select-none">
                    <input type="checkbox" name="no_contract_end" value="1"
                      checked={noContractEnd} onChange={(e) => setNoContractEnd(e.target.checked)}
                      disabled={isViewOnly} className="rounded accent-violet-600" />
                    {t("admin_client_new_monthly_no_end")}
                  </label>
                </div>
                <div className="space-y-1.5 col-span-2">
                  <Label htmlFor="notes">{t("admin_client_new_notes")}</Label>
                  <textarea id="notes" name="notes" rows={2} defaultValue={v.notes} disabled={isViewOnly}
                    className={`w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 resize-none transition ${isViewOnly ? "bg-slate-50 text-slate-500" : ""}`} />
                </div>
              </div>
            </SectionCard>
          </Form>

          {/* Account access */}
          {!isViewOnly && (
            <SectionCard title={t("admin_change_email_title")} subtitle={t("admin_change_email_desc")}>
              <div className="grid grid-cols-2 gap-4">
                {/* Change email */}
                <div className="space-y-3">
                  <p className="text-xs font-medium text-slate-700">{t("admin_change_email_title")}</p>
                  {emailChanged && (
                    <p className="flex items-center gap-2 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                      <FaCircleCheck />
                      {t("admin_change_email_success")} — {(actionData!.success as any).email}
                    </p>
                  )}
                  {errors?.email && (
                    <p className="text-xs font-medium text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
                      {actionData?.emailDuplicate ? t("admin_change_email_duplicate") : errors.email[0]}
                    </p>
                  )}
                  <Form method="post" className="space-y-2">
                    <input type="hidden" name="intent" value="update_email" />
                    <Input name="email" type="email" defaultValue={currentEmail} required placeholder="email@example.com" />
                    <Button type="submit" className="w-full bg-slate-900 hover:bg-slate-700 text-white text-sm">
                      <FaEnvelope className="text-xs" />
                      {t("admin_change_email_btn")}
                    </Button>
                  </Form>
                </div>

                {/* Send magic link */}
                <div className="space-y-3">
                  <p className="text-xs font-medium text-slate-700">{t("admin_send_magic_link_title")}</p>
                  <p className="text-xs text-slate-500">{t("admin_send_magic_link_desc")}</p>
                  {magicLinkSent && (
                    <p className="flex items-center gap-2 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                      <FaCircleCheck />
                      {t("admin_send_magic_link_success")} — {(actionData!.success as any).email}
                    </p>
                  )}
                  <Form method="post">
                    <input type="hidden" name="intent" value="send_magic_link" />
                    <Button type="submit" className="w-full bg-violet-600 hover:bg-violet-700 text-white text-sm">
                      <FaPaperPlane className="text-xs" />
                      {t("admin_send_magic_link_btn")}
                    </Button>
                  </Form>
                </div>
              </div>
            </SectionCard>
          )}

          {/* Impersonate */}
          {canImpersonate && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-100 text-amber-700 shrink-0">
                  <FaUserSecret />
                </span>
                <div>
                  <p className="text-sm font-semibold text-amber-900">{t("admin_impersonate_title")}</p>
                  <p className="text-xs text-amber-700 mt-0.5">{t("admin_impersonate_desc")}</p>
                </div>
              </div>
              <Form method="post" className="shrink-0">
                <input type="hidden" name="intent" value="impersonate" />
                <button type="submit"
                  className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600 transition-colors whitespace-nowrap">
                  {t("admin_impersonate_btn")}
                </button>
              </Form>
            </div>
          )}

          {/* Danger zone */}
          {!isViewOnly && (
            <div className="bg-rose-50 border border-rose-200 rounded-xl p-5 flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-rose-900">{t("admin_client_delete_title")}</p>
                <p className="text-xs text-rose-700 mt-0.5">{t("admin_client_delete_desc")}</p>
              </div>
              <Form method="post" className="shrink-0"
                onSubmit={(e: ReactFormEvent<HTMLFormElement>) => {
                  if (!confirm(t("admin_client_delete_confirm"))) e.preventDefault();
                }}>
                <input type="hidden" name="intent" value="delete_client" />
                <button type="submit"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 transition-colors">
                  <FaTrash className="text-xs" />
                  {t("admin_client_delete_btn")}
                </button>
              </Form>
            </div>
          )}
        </div>

        {/* ── Right column — Internal Notes ── */}
        <div className="lg:col-span-4">
          <div className="sticky top-6">
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
                <div>
                  <p className="text-sm font-semibold text-slate-900">Internal Notes</p>
                  <p className="text-xs text-slate-500 mt-0.5">บันทึกภายใน สำหรับ Admin และ Co-Admin</p>
                </div>
                <span className="text-xs font-medium text-slate-500 bg-slate-100 px-2 py-1 rounded-full">
                  {notes.length}
                </span>
              </div>

              {/* Add note */}
              <div className="p-4 border-b border-slate-100 bg-slate-50/50">
                <Form method="post" className="space-y-2" key={`note-${notes.length}`}>
                  <input type="hidden" name="intent" value="add_note" />
                  <textarea name="note" rows={3} placeholder="เพิ่มบันทึกใหม่..."
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 resize-none transition" />
                  {actionData?.errors?.note && (
                    <p className="text-xs text-red-500">{actionData.errors.note[0]}</p>
                  )}
                  {noteAdded && (
                    <p className="flex items-center gap-1.5 text-xs text-emerald-700">
                      <FaCircleCheck className="text-[10px]" /> บันทึกเพิ่มแล้ว
                    </p>
                  )}
                  <div className="flex justify-end">
                    <Button type="submit" className="bg-slate-900 hover:bg-slate-700 text-white text-xs h-8 px-3">
                      เพิ่มบันทึก
                    </Button>
                  </div>
                </Form>
              </div>

              {/* Notes list */}
              <div className="divide-y divide-slate-100 max-h-[500px] overflow-y-auto">
                {notes.length === 0 ? (
                  <div className="py-10 text-center">
                    <p className="text-xs text-slate-500">ยังไม่มีบันทึก</p>
                  </div>
                ) : (
                  notes.map((note: any) => {
                    const isAdmin = note.user_role === "admin";
                    return (
                      <div key={note.id} className="p-4 hover:bg-slate-50/50 transition-colors">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
                              <span className="text-xs font-medium text-slate-700 truncate">{note.user_name}</span>
                              <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                                isAdmin ? "bg-violet-100 text-violet-700" : "bg-emerald-100 text-emerald-700"
                              }`}>
                                {isAdmin ? "Admin" : "Co-Admin"}
                              </span>
                            </div>
                            <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">{note.note}</p>
                            <p className="text-[11px] text-slate-500 mt-1.5">
                              {new Date(note.created_at * 1000).toLocaleString("th-TH")}
                            </p>
                          </div>
                          {(currentUser.role === "admin" || currentUser.role === "co-admin" || note.user_id === currentUser.id) && (
                            <Form method="post" className="shrink-0">
                              <input type="hidden" name="intent" value="delete_note" />
                              <input type="hidden" name="note_id" value={note.id} />
                              <button type="submit"
                                onClick={(e) => { if (!confirm("ลบบันทึกนี้?")) e.preventDefault(); }}
                                className="p-1.5 rounded-lg text-slate-300 hover:text-rose-500 hover:bg-rose-50 transition-colors"
                                title="ลบบันทึก">
                                <FaTrash className="text-[10px]" />
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
    </div>
  );
}
