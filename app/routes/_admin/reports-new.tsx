import { redirect } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/reports-new";
import { requireAdmin } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";
import { generateId, getThaiMonth } from "~/lib/utils";
import PageHeader from "~/components/layout/PageHeader";
import ReportEditor from "~/routes/_admin/reports-editor";
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
  client_id: z.string().min(1, "กรุณาเลือกลูกค้า"),
  year: z.coerce.number().int().min(2020).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  title: z.string().min(1, "กรุณาระบุชื่อรายงาน"),
  summary: z.string().optional(),
  uptime_percent: z.coerce.number().min(0).max(100).optional().nullable(),
  speed_score: z.coerce.number().int().min(0).max(100).optional().nullable(),
  tasks_json: z.string().default("[]"),
  intent: z.enum(["draft", "publish"]).default("draft"),
});

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  await requireAdmin(request, env.DB, env.SESSION_KV);
  const db = createDB(env.DB);
  const clients = await db.listClients();
  return { clients };
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  await requireAdmin(request, env.DB, env.SESSION_KV);
  const db = createDB(env.DB);

  const formData = await request.formData();
  const raw = Object.fromEntries(formData);
  const parsed = ReportSchema.safeParse(raw);

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const {
    client_id, year, month, title, summary,
    uptime_percent, speed_score, tasks_json, intent,
  } = parsed.data;

  // Parse tasks
  let tasks: z.infer<typeof TaskSchema>[] = [];
  try {
    const raw = JSON.parse(tasks_json);
    tasks = z.array(TaskSchema).parse(raw);
  } catch {
    return { errors: { tasks_json: ["รายการงานไม่ถูกต้อง"] } };
  }

  const reportId = generateId();
  const isPublish = intent === "publish";
  const now = Math.floor(Date.now() / 1000);

  await db.createReport({
    id: reportId,
    client_id,
    year,
    month,
    title,
    summary: summary ?? null,
    uptime_percent: uptime_percent ?? null,
    speed_score: speed_score ?? null,
    total_tasks: tasks.length,
    status: isPublish ? "published" : "draft",
    published_at: isPublish ? now : null,
  });

  // Create tasks
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

  // Send notification on publish
  if (isPublish) {
    const client = await db.getClientById(client_id);
    if (client) {
      await db.createNotification({
        id: generateId(),
        user_id: client.user_id,
        type: "report_published",
        title: `รายงานประจำเดือน ${getThaiMonth(month)} ${year + 543} พร้อมแล้ว`,
        body: "ทีม DoAction ได้เผยแพร่รายงานสรุปงานสำหรับเดือนนี้แล้ว",
        link: `/reports/${reportId}`,
        read: 0,
      });
    }
  }

  return redirect(`/admin/reports/${reportId}`);
}

export default function AdminReportNewPage({ loaderData }: Route.ComponentProps) {
  const { clients } = loaderData;
  return (
    <div className="space-y-6 max-w-4xl">
      <PageHeader
        title="สร้าง Report ใหม่"
        breadcrumbs={[
          { label: "Admin", href: "/admin/clients" },
          { label: "Reports", href: "/admin/reports" },
          { label: "ใหม่" },
        ]}
      />
      <ReportEditor clients={clients} isNew={true} />
    </div>
  );
}
