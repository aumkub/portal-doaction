import { redirect } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/reports-new";
import { requireAdmin } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";
import { generateId, getThaiMonth } from "~/lib/utils";
import { sendTelegramNotification } from "~/lib/telegram.server";
import { fetchUptimeForWebsite } from "~/lib/uptime.server";
import { sendEmail } from "~/lib/email.server";
import { buildReportCustomerNotification } from "~/lib/report-customer-email.server";
import { createReportAccessToken } from "~/lib/report-access.server";
import { parseClientCcEmails } from "~/lib/client-cc";
import ReportEditor from "~/routes/_admin/reports-editor";
import { useT } from "~/lib/i18n";
import type { TaskCategory } from "~/types";

export function meta() {
  return [{ title: "สร้าง Report ใหม่ — Admin" }];
}

const TaskSchema = z.object({
  category: z.enum([
    "maintenance", "development", "security", "seo", "performance", "other",
  ]),
  title: z.string().min(1),
  description: z.string().optional(),
});

const ReportSchema = z.object({
  client_id: z.string().optional().default(""),
  client_ids_json: z.string().optional().default("[]"),
  uptime_overrides_json: z.string().optional().default("{}"),
  year: z.coerce.number().int().min(2020).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  title: z.string().min(1, "กรุณาระบุชื่อรายงาน"),
  summary: z.string().optional(),
  uptime_percent: z.coerce.number().min(0).max(100).optional().nullable(),
  speed_score: z.coerce.number().int().min(0).max(100).optional().nullable(),
  tasks_json: z.string().default("[]"),
  intent: z.enum(["draft", "publish"]).default("draft"),
  send_email: z.string().optional().default("0"),
});

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  await requireAdmin(request, env.DB, env.SESSIONPORTAL);
  const db = createDB(env.DB);
  const clients = await db.listClients();
  return { clients };
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  await requireAdmin(request, env.DB, env.SESSIONPORTAL);
  const db = createDB(env.DB);

  const formData = await request.formData();
  const raw = Object.fromEntries(formData);
  const parsed = ReportSchema.safeParse(raw);

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const {
    client_id, client_ids_json, uptime_overrides_json, year, month, title, summary,
    uptime_percent, speed_score, tasks_json, intent, send_email,
  } = parsed.data;

  // Parse tasks
  let tasks: z.infer<typeof TaskSchema>[] = [];
  try {
    const raw = JSON.parse(tasks_json);
    tasks = z.array(TaskSchema).parse(raw);
  } catch {
    return { errors: { tasks_json: ["รายการงานไม่ถูกต้อง"] } };
  }

  const isPublish = intent === "publish";
  const now = Math.floor(Date.now() / 1000);
  const apiKey =
    (env as any).UPTIMEROBOT_API_KEY ?? "ur2618139-5281beb51ff9820a629669c2";

  let clientIds: string[] = [];
  try {
    const parsedClientIds = JSON.parse(client_ids_json);
    if (Array.isArray(parsedClientIds)) {
      clientIds = parsedClientIds.filter((id): id is string => typeof id === "string");
    }
  } catch {
    // ignore invalid JSON and fallback to legacy client_id
  }

  if (clientIds.length === 0 && client_id) {
    clientIds = [client_id];
  }

  if (clientIds.length === 0) {
    return { errors: { client_ids_json: ["กรุณาเลือกลูกค้าอย่างน้อย 1 ราย"] } };
  }

  const uniqueClientIds = [...new Set(clientIds)];

  let uptimeOverrides: Record<string, string> = {};
  try {
    const rawOverrides = JSON.parse(uptime_overrides_json);
    if (rawOverrides && typeof rawOverrides === "object") {
      uptimeOverrides = rawOverrides as Record<string, string>;
    }
  } catch {
    // ignore malformed override JSON
  }

  const createdReportIds: string[] = [];
  const failedClients: string[] = [];

  for (const currentClientId of uniqueClientIds) {
    const client = await db.getClientById(currentClientId);
    if (!client) {
      failedClients.push(currentClientId);
      continue;
    }

    const existing = await db.getReportByMonth(currentClientId, year, month);
    if (existing) {
      failedClients.push(client.company_name);
      continue;
    }

    const overrideRaw = uptimeOverrides[currentClientId]?.trim();
    const overrideValue = overrideRaw ? Number(overrideRaw) : null;
    let resolvedUptime: number | null = null;
    if (overrideValue != null && !Number.isNaN(overrideValue)) {
      resolvedUptime = Math.max(0, Math.min(100, overrideValue));
    } else if (client.website_url) {
      const uptime = await fetchUptimeForWebsite(client.website_url, apiKey);
      resolvedUptime = uptime.uptimeRatio;
    } else {
      resolvedUptime = uptime_percent ?? null;
    }

    const reportId = generateId();
    await db.createReport({
      id: reportId,
      client_id: currentClientId,
      year,
      month,
      title,
      summary: summary ?? null,
      uptime_percent: resolvedUptime,
      speed_score: speed_score ?? null,
      total_tasks: tasks.length,
      status: isPublish ? "published" : "draft",
      published_at: isPublish ? now : null,
    });

    for (let i = 0; i < tasks.length; i++) {
      await db.createReportTask({
        id: generateId(),
        report_id: reportId,
        category: tasks[i].category as TaskCategory,
        title: tasks[i].title,
        description: tasks[i].description ?? null,
        completed: 1,
        sort_order: i,
      });
    }

    if (isPublish) {
      const notification = {
        id: generateId(),
        user_id: client.user_id,
        type: "report_published",
        title: `รายงานประจำเดือน ${getThaiMonth(month)} ${year + 543} พร้อมแล้ว`,
        body: "ทีม do action ได้เผยแพร่รายงานสรุปงานสำหรับเดือนนี้แล้ว",
        link: `/reports/${reportId}`,
        read: 0,
      } as const;
      await db.createNotification(notification);
      await sendTelegramNotification({
        db,
        appUrl: env.APP_URL,
        notification,
      });

      // Send email notification to client if requested
      if (send_email === "1" && env.SEND_EMAIL) {
        const clientUser = await db.getUserById(client.user_id);
        if (clientUser?.email) {
          const origin = env.APP_URL || new URL(request.url).origin;
          const secret = env.SESSION_SECRET || "doaction-report-link-secret";
          const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 14;
          const token = await createReportAccessToken(
            { reportId, email: clientUser.email.toLowerCase(), exp },
            secret
          );
          const reportUrl = `${String(origin).replace(/\/$/, "")}/public/report/${reportId}?t=${encodeURIComponent(token)}`;
          const lang = clientUser.language === "en" ? "en" : "th";
          const { subject, html, text } = buildReportCustomerNotification({
            companyName: client.company_name,
            contactName: clientUser.name,
            reportTitle: title,
            year,
            month,
            summary: summary ?? null,
            reportUrl,
            lang,
          });
          const ccRecipients = parseClientCcEmails(client.cc_emails).map((email) => ({ email }));
          const now = Math.floor(Date.now() / 1000);
          context.cloudflare.ctx.waitUntil(
            (async () => {
              try {
                await sendEmail({
                  to: clientUser.email!,
                  toName: clientUser.name,
                  cc: ccRecipients,
                  subject,
                  html,
                  text,
                  sendEmail: env.SEND_EMAIL,
                  db,
                  source: "report_notify",
                });
                await db.updateReport(reportId, {
                  client_notified_at: now,
                  client_notification_subject: subject,
                  client_notification_html: html,
                });
                await sendTelegramNotification({
                  db,
                  appUrl: env.APP_URL,
                  notification: {
                    title: `📧 ส่งอีเมลรายงานให้ ${client.company_name} แล้ว`,
                    body: `${clientUser.email} — ${title}`,
                    link: `/admin/reports/${reportId}`,
                  },
                });
              } catch (e) {
                console.error("[report-notify on create]", e);
              }
            })()
          );
        }
      }
    }

    createdReportIds.push(reportId);
  }

  const search = new URLSearchParams({
    bulkCreated: String(createdReportIds.length),
    bulkFailed: String(failedClients.length),
  });
  return redirect(`/admin/reports?${search.toString()}`);
}

export default function AdminReportNewPage({ loaderData, actionData }: Route.ComponentProps) {
  const { clients } = loaderData;
  const errors = (actionData as { errors?: Record<string, string[]> } | undefined)?.errors;
  const { t } = useT();
  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <a
          href="/admin/reports"
          className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 transition-colors mb-4"
        >
          ← {t("admin_breadcrumb_reports")}
        </a>
        <h1 className="text-2xl font-semibold text-slate-900">{t("admin_report_new_title")}</h1>
      </div>
      <ReportEditor clients={clients} isNew={true} errors={errors} />
    </div>
  );
}
