import { Form, Link, redirect } from "react-router";
import { emailTeamNewTicket } from "~/lib/email-alerts.server";
import { z } from "zod";
import { requireUser } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";
import { generateId } from "~/lib/utils";
import { useT } from "~/lib/i18n";
import { NativeSelect } from "~/components/ui/native-select";
import { sendTelegramNotificationForClient } from "~/lib/telegram.server";

const TicketSchema = z.object({
  title: z.string().min(1, "กรุณากรอกหัวข้อ"),
  description: z.string().min(1, "กรุณาระบุรายละเอียด"),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
});

export function meta() {
  return [{ title: "New Ticket — do action portal" }];
}

export async function action({ request, context }: any) {
  const user = await requireUser(
    request,
    context.cloudflare.env.DB,
    context.cloudflare.env.SESSIONPORTAL
  );
  const db = createDB(context.cloudflare.env.DB);
  const client = await db.getClientByUserId(user.id);
  if (!client) return { error: "Client not found" };

  const formData = await request.formData();
  const parsed = TicketSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const ticketId = generateId();
  await db.createTicket({
    id: ticketId,
    client_id: client.id,
    title: parsed.data.title,
    description: parsed.data.description,
    priority: parsed.data.priority,
    status: "open",
    created_by: user.id,
    assigned_to: null,
    resolved_at: null,
  });

  const admins = await db.listAdminUsers();
  const notificationTitle = `New ticket from ${client.company_name}`;
  await Promise.all(
    admins.map((admin) =>
      db.createNotification({
        id: generateId(),
        user_id: admin.id,
        type: "ticket",
        title: notificationTitle,
        body: parsed.data.title,
        link: `/admin/tickets`,
        read: 0,
      })
    )
  );
  await sendTelegramNotificationForClient({
    db,
    appUrl: context.cloudflare.env.APP_URL,
    notification: { title: notificationTitle, body: parsed.data.title, link: "/admin/tickets" },
    clientId: client.id,
  });
  try {
    await emailTeamNewTicket(
      context.cloudflare.env,
      db,
      { id: ticketId, title: parsed.data.title, description: parsed.data.description, priority: parsed.data.priority },
      client.company_name
    );
  } catch (e) {
    // The ticket exists either way; in-app + Telegram already went out.
    console.error("[tickets.new] team email failed", e);
  }

  return redirect(`/tickets/${ticketId}`);
}

export default function NewTicketPage({ actionData }: any) {
  const errors = actionData?.errors;
  const { t } = useT();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-[28px] md:text-[32px] font-bold leading-tight tracking-[-0.02em] text-ink">{t("new_ticket_title")}</h1>
        <p className="mt-1 text-sm text-muted-ink">{t("new_ticket_subtitle")}</p>
      </div>

      <div className="rounded-[20px] border border-line bg-white p-5 md:p-6">
        <Form method="post" className="space-y-5">
          <div>
            <label className="mb-1.5 block text-[13px] font-medium text-ink-soft">
              {t("field_subject")}
            </label>
            <input
              name="title"
              required
              placeholder={t("ph_subject")}
              className="h-10 w-full rounded-xl border border-line bg-white px-3.5 text-sm text-ink placeholder:text-faint-ink outline-none focus:border-ink/40 focus:ring-2 focus:ring-ink/10 transition-[border,box-shadow]"
            />
            {errors?.title ? (
              <p className="mt-1 text-xs text-brand-red-dark">{errors.title[0]}</p>
            ) : null}
          </div>

          <div>
            <label className="mb-1.5 block text-[13px] font-medium text-ink-soft">
              {t("field_description")}
            </label>
            <textarea
              name="description"
              required
              rows={6}
              placeholder={t("ph_description")}
              className="w-full rounded-[14px] border border-line bg-white px-3.5 py-2.5 text-sm text-ink placeholder:text-faint-ink outline-none focus:border-ink/40 focus:ring-2 focus:ring-ink/10 transition-[border,box-shadow]"
            />
            {errors?.description ? (
              <p className="mt-1 text-xs text-brand-red-dark">{errors.description[0]}</p>
            ) : null}
          </div>

          <div>
            <label className="mb-1.5 block text-[13px] font-medium text-ink-soft">
              {t("field_priority")}
            </label>
            <NativeSelect
              name="priority"
              defaultValue="medium"
              className="h-10 rounded-xl border-line bg-white text-ink focus:border-ink/40 focus:ring-2 focus:ring-ink/10"
            >
              <option value="low">{t("priority_low")}</option>
              <option value="medium">{t("priority_medium")}</option>
              <option value="high">{t("priority_high")}</option>
              <option value="urgent">{t("priority_urgent")}</option>
            </NativeSelect>
          </div>

          <div className="flex flex-col-reverse gap-3 pt-4 border-t border-line-soft sm:flex-row sm:justify-end">
            <Link
              to="/tickets"
              className="inline-flex h-11 sm:h-10 items-center justify-center rounded-full border border-line bg-white px-4 text-[13px] font-semibold text-ink hover:bg-paper transition-colors"
            >
              {t("cancel")}
            </Link>
            <button
              type="submit"
              className="h-11 sm:h-10 rounded-full bg-ink px-5 text-[13px] font-semibold text-white hover:bg-black transition-colors"
            >
              {t("btn_submit_ticket")}
            </button>
          </div>
        </Form>
      </div>
    </div>
  );
}
