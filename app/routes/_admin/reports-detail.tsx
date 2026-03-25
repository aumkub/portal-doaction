import { redirect } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/reports-detail";
import { requireAdmin } from "~/lib/auth.server";
import { createDB } from "~/lib/db.server";
import { generateId, getThaiMonth } from "~/lib/utils";
import PageHeader from "~/components/layout/PageHeader";
import ReportEditor from "~/routes/_admin/reports-editor";
import type { TaskCategory } from "~/types";

export function meta() {
  return [{ title: "แก้ไข Report — Admin" }];
}

const TaskSchema = z.object({
  category: z.enum([
    "maintenance", "development", "security", "seo", "performance", "other",
  ]),
  title: z.string().min(1),
  description: z.string().optional(),
});

const ReportSchema = z.object({
  client_id: z.string().min(1),
  year: z.coerce.number().int().min(2020).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  title: z.string().min(1),
  summary: z.string().optional(),
  uptime_percent: z.coerce.number().min(0).max(100).optional().nullable(),
  speed_score: z.coerce.number().int().min(0).max(100).optional().nullable(),
  tasks_json: z.string().default("[]"),
  intent: z.enum(["draft", "publish"]).default("draft"),
});

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  await requireAdmin(request, env.DB, env.SESSION_KV);
  const db = createDB(env.DB);

  const report = await db.getReport(params.reportId);
  if (!report) throw new Response("Not Found", { status: 404 });

  const [tasks, clients] = await Promise.all([
    db.listTasksByReport(report.id),
    db.listClients(),
  ]);

  return { report, tasks, clients };
}

export async function action({ request, params, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  await requireAdmin(request, env.DB, env.SESSION_KV);
  const db = createDB(env.DB);

  const existing = await db.getReport(params.reportId);
  if (!existing) throw new Response("Not Found", { status: 404 });

  const formData = await request.formData();
  const raw = Object.fromEntries(formData);
  const parsed = ReportSchema.safeParse(raw);
  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors };
  }

  const {
    title, summary, uptime_percent, speed_score,
    tasks_json, intent,
  } = parsed.data;

  let tasks: z.infer<typeof TaskSchema>[] = [];
  try {
    tasks = z.array(TaskSchema).parse(JSON.parse(tasks_json));
  } catch {
    return { errors: { tasks_json: ["รายการงานไม่ถูกต้อง"] } };
  }

  const isPublishing = intent === "publish" && existing.status === "draft";
  const now = Math.floor(Date.now() / 1000);

  await db.updateReport(params.reportId, {
    title,
    summary: summary ?? null,
    uptime_percent: uptime_percent ?? null,
    speed_score: speed_score ?? null,
    total_tasks: tasks.length,
    status: intent === "publish" ? "published" : "draft",
    published_at:
      intent === "publish"
        ? existing.published_at ?? now
        : existing.published_at,
  });

  // Replace all tasks: delete existing, re-insert
  const oldTasks = await db.listTasksByReport(params.reportId);
  for (const t of oldTasks) {
    await db.deleteReportTask(t.id);
  }
  for (let i = 0; i < tasks.length; i++) {
    await db.createReportTask({
      id: generateId(),
      report_id: params.reportId,
      category: tasks[i].category as TaskCategory,
      title: tasks[i].title,
      description: tasks[i].description ?? null,
      completed: 1,
      sort_order: i,
    });
  }

  // Send notification when first publishing
  if (isPublishing) {
    const client = await db.getClientById(existing.client_id);
    if (client) {
      await db.createNotification({
        id: generateId(),
        user_id: client.user_id,
        type: "report_published",
        title: `รายงานประจำเดือน ${getThaiMonth(existing.month)} ${existing.year + 543} พร้อมแล้ว`,
        body: "ทีม DoAction ได้เผยแพร่รายงานสรุปงานสำหรับเดือนนี้แล้ว",
        link: `/reports/${existing.id}`,
        read: 0,
      });
    }
  }

  return redirect(`/admin/reports/${params.reportId}`);
}

export default function AdminReportDetailPage({
  loaderData,
}: Route.ComponentProps) {
  const { report, tasks, clients } = loaderData;

  return (
    <div className="space-y-6 max-w-4xl">
      <PageHeader
        title={`${getThaiMonth(report.month)} ${report.year + 543}`}
        subtitle={
          report.status === "published"
            ? "เผยแพร่แล้ว — แก้ไขจะอัปเดทหน้าลูกค้าทันที"
            : "Draft — ลูกค้าจะเห็น Report นี้หลังจาก Publish"
        }
        breadcrumbs={[
          { label: "Admin", href: "/admin/clients" },
          { label: "Reports", href: "/admin/reports" },
          { label: `${getThaiMonth(report.month)} ${report.year + 543}` },
        ]}
      />
      <ReportEditor
        report={report}
        tasks={tasks}
        clients={clients}
        isNew={false}
      />
    </div>
  );
}
