import { Form, redirect, useActionData } from "react-router";
import { z } from "zod";
import { useState } from "react";
import { requireAdmin, startImpersonation } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";
import { useT } from "~/lib/i18n";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Button } from "~/components/ui/button";

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
});

export async function loader({ request, params, context }: any) {
  const env = context.cloudflare.env;
  await requireAdmin(request, env.DB, env.SESSIONPORTAL);
  const db = createDB(env.DB);

  const client = await db.getClientById(params.clientId);
  if (!client) throw new Response("Not Found", { status: 404 });

  const user = await db.getUserById(client.user_id);
  const [reports, tickets] = await Promise.all([
    db.listReportsByClient(client.id),
    db.listTicketsByClient(client.id),
  ]);

  return { client, user, reportsCount: reports.length, ticketsCount: tickets.length };
}

export async function action({ request, params, context }: any) {
  const env = context.cloudflare.env;
  const admin = await requireAdmin(request, env.DB, env.SESSIONPORTAL);
  const db = createDB(env.DB);
  const client = await db.getClientById(params.clientId);
  if (!client) throw new Response("Not Found", { status: 404 });

  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

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
        },
      };
    }

    const { name, company_name, website_url, package: pkg, contract_start, contract_end, notes } =
      parsed.data;
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
    });

    return redirect(`/admin/clients/${params.clientId}`);
  }

  if (intent === "impersonate") {
    const sessionCookie = await startImpersonation(
      request,
      env.DB,
      env.SESSIONPORTAL,
      client.user_id,
      admin.id
    );

    return redirect("/dashboard", {
      headers: { "Set-Cookie": sessionCookie.serialize() },
    });
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
  };
};

export default function AdminClientDetailPage({ loaderData }: any) {
  const { client, user, reportsCount, ticketsCount } = loaderData;
  const { t } = useT();
  const actionData = useActionData() as ActionData | undefined;

  const v =
    actionData?.values ?? {
      name: user?.name ?? "",
      company_name: client.company_name,
      website_url: client.website_url ?? "",
      package: client.package,
      contract_start: client.contract_start ?? "",
      contract_end: client.contract_end ?? "",
      notes: client.notes ?? "",
    };

  const errors = actionData?.errors;
  const noContractEndInitial =
    actionData?.noContractEnd !== undefined
      ? actionData.noContractEnd
      : !client.contract_end;

  const [noContractEnd, setNoContractEnd] = useState(noContractEndInitial);

  const formKey = `${client.id}-${actionData?.errors ? "err" : "ok"}`;

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{client.company_name}</h1>
          <p className="text-sm text-slate-500 mt-1">{t("admin_client_detail_subtitle")}</p>
        </div>
        <a href="/admin/clients" className="text-sm text-slate-500 hover:text-slate-900">
          {t("admin_back_clients")}
        </a>
      </div>

      <Form
        method="post"
        key={formKey}
        className="bg-white rounded-xl border border-slate-200 p-5 space-y-4"
      >
        <input type="hidden" name="intent" value="update_client" />
        <h2 className="text-sm font-semibold text-slate-900">{t("admin_client_edit_heading")}</h2>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="name">{t("admin_client_new_name")}</Label>
            <Input id="name" name="name" defaultValue={v.name} required />
            {errors?.name && <p className="text-red-500 text-xs">{errors.name[0]}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email">{t("settings_email_label")}</Label>
            <Input id="email" type="email" value={user?.email ?? ""} readOnly className="bg-slate-50" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5 col-span-2">
            <Label htmlFor="company_name">{t("admin_client_new_company_name")}</Label>
            <Input id="company_name" name="company_name" defaultValue={v.company_name} required />
            {errors?.company_name && (
              <p className="text-red-500 text-xs">{errors.company_name[0]}</p>
            )}
          </div>
          <div className="space-y-1.5 col-span-2">
            <Label htmlFor="website_url">{t("admin_client_new_website")}</Label>
            <Input
              id="website_url"
              name="website_url"
              type="url"
              defaultValue={v.website_url}
              placeholder="https://example.com"
            />
            {errors?.website_url && <p className="text-red-500 text-xs">{errors.website_url[0]}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="package">{t("settings_package_label")}</Label>
            <select
              id="package"
              name="package"
              defaultValue={v.package}
              className="w-full h-10 rounded-lg border border-slate-200 px-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-900"
            >
              <option value="basic">{t("admin_pkg_basic")}</option>
              <option value="standard">{t("admin_pkg_standard")}</option>
              <option value="premium">{t("admin_pkg_premium")}</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="contract_start">{t("admin_client_new_contract_start")}</Label>
            <Input id="contract_start" name="contract_start" type="date" defaultValue={v.contract_start} />
          </div>
          <div className="space-y-1.5 col-span-2">
            <Label htmlFor="contract_end">{t("admin_client_new_contract_end")}</Label>
            <Input
              id="contract_end"
              name="contract_end"
              type="date"
              defaultValue={v.contract_end}
              disabled={noContractEnd}
            />
            <label className="mt-2 inline-flex items-center gap-2 text-xs text-slate-600">
              <input
                type="checkbox"
                name="no_contract_end"
                value="1"
                checked={noContractEnd}
                onChange={(e) => setNoContractEnd(e.target.checked)}
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
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 resize-none"
            />
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <Button type="submit" className="bg-violet-600 hover:bg-violet-700 text-white">
            {t("save")}
          </Button>
        </div>
      </Form>

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-xs text-slate-400">{t("admin_reports_total")}</p>
          <p className="text-2xl font-semibold text-slate-900 mt-1">{reportsCount}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-xs text-slate-400">{t("admin_tickets_total_label")}</p>
          <p className="text-2xl font-semibold text-slate-900 mt-1">{ticketsCount}</p>
        </div>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
        <p className="text-sm text-amber-900 font-medium">{t("admin_impersonate_title")}</p>
        <p className="text-xs text-amber-800 mt-1">{t("admin_impersonate_desc")}</p>
        <Form method="post" className="mt-3">
          <input type="hidden" name="intent" value="impersonate" />
          <button
            type="submit"
            className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600"
          >
            {t("admin_impersonate_btn")}
          </button>
        </Form>
      </div>
    </div>
  );
}
