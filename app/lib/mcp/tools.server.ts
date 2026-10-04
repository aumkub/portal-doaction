import { z } from "zod";
import { isContractExpired } from "~/lib/contract";
import type { DB } from "~/lib/db.server";
import type { User, SupportTicket, TaskCategory } from "~/types";
import { generateId, getThaiMonth } from "~/lib/utils";
import { parseClientCcEmails } from "~/lib/client-cc";
import { sendTelegramNotification } from "~/lib/telegram.server";
import {
  sendTicketClosedEmailToClient,
  sendTicketEmailToClient,
} from "~/lib/ticket-email.server";
import { notifyReportToClient } from "~/lib/report-notify.server";

export interface ToolContext {
  env: CloudflareEnv;
  db: DB;
  user: User;
  origin: string;
}

interface ToolDef<S extends z.ZodObject> {
  name: string;
  title: string;
  description: string;
  input: S;
  /** MCP hints: read-only tools are safe to auto-run; destructive ones should be confirmed. */
  readOnly?: boolean;
  destructive?: boolean;
  run: (args: z.infer<S>, ctx: ToolContext) => Promise<unknown>;
}

function tool<S extends z.ZodObject>(def: ToolDef<S>): ToolDef<S> {
  return def;
}

export class ToolError extends Error {}

// ── Shared schemas ───────────────────────────────────────────────────────────

const TicketStatus = z.enum(["open", "in_progress", "waiting", "resolved", "closed"]);
const TicketPriority = z.enum(["low", "medium", "high", "urgent"]);
const TaskCategorySchema = z.enum([
  "maintenance",
  "development",
  "security",
  "seo",
  "performance",
  "other",
]);
const TaskInput = z.object({
  category: TaskCategorySchema,
  title: z.string().min(1),
  description: z.string().optional(),
});

const UNRESOLVED = ["open", "in_progress", "waiting"];

const STATUS_LABEL_TH: Record<string, string> = {
  open: "เปิด",
  in_progress: "กำลังดำเนินการ",
  waiting: "รอข้อมูล",
  resolved: "แก้ไขแล้ว",
  closed: "ปิดแล้ว",
};

const now = () => Math.floor(Date.now() / 1000);

/** Current year/month in Bangkok time, which is how the team thinks about report months. */
function bangkokYearMonth(): { year: number; month: number } {
  const d = new Date(Date.now() + 7 * 3600 * 1000);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

async function mustGetTicket(db: DB, id: string): Promise<SupportTicket> {
  const ticket = await db.getTicket(id);
  if (!ticket || ticket.deleted_at) throw new ToolError(`Ticket ${id} not found`);
  return ticket;
}

async function mustGetClient(db: DB, id: string) {
  const client = await db.getClientById(id);
  if (!client) throw new ToolError(`Client ${id} not found`);
  return client;
}

async function notifyReportPublished(ctx: ToolContext, reportId: string, clientId: string, year: number, month: number) {
  const client = await ctx.db.getClientById(clientId);
  if (!client) return;
  const notification = {
    id: generateId(),
    user_id: client.user_id,
    type: "report_published",
    title: `รายงานประจำเดือน ${getThaiMonth(month)} ${year + 543} พร้อมแล้ว`,
    body: "ทีม do action ได้เผยแพร่รายงานสรุปงานสำหรับเดือนนี้แล้ว",
    link: `/reports/${reportId}`,
    read: 0,
  } as const;
  await ctx.db.createNotification(notification);
  await sendTelegramNotification({ db: ctx.db, appUrl: ctx.env.APP_URL, notification });
}

// ── Tools ────────────────────────────────────────────────────────────────────

export const tools = [
  tool({
    name: "dashboard_summary",
    title: "Dashboard summary",
    description:
      "Overview of the portal: client count, unresolved tickets by status and priority, and clients still missing a report for the current month (Bangkok time).",
    input: z.object({}),
    readOnly: true,
    async run(_args, { db }) {
      const [allClients, open] = await Promise.all([db.listClients(), db.listAllOpenTickets()]);
      const clients = allClients.filter((c) => !isContractExpired(c.contract_end));
      const { year, month } = bangkokYearMonth();
      const missing = await db.listClientsWithoutReportForMonth(year, month);
      const count = (key: "status" | "priority") =>
        open.reduce<Record<string, number>>((acc, t) => {
          acc[t[key]] = (acc[t[key]] ?? 0) + 1;
          return acc;
        }, {});
      return {
        clients: clients.length,
        unresolved_tickets: open.length,
        by_status: count("status"),
        by_priority: count("priority"),
        oldest_unresolved: open.slice(0, 5).map((t) => ({
          id: t.id,
          title: t.title,
          company_name: t.company_name,
          status: t.status,
          priority: t.priority,
          created_at: t.created_at,
        })),
        report_month: { year, month },
        clients_missing_report: missing.map((c) => ({ id: c.id, company_name: c.company_name })),
      };
    },
  }),

  tool({
    name: "list_clients",
    title: "List clients",
    description: "List active clients. Optional case-insensitive search on company name or website.",
    input: z.object({ search: z.string().optional() }),
    readOnly: true,
    async run({ search }, { db }) {
      const q = search?.toLowerCase();
      return (await db.listClients())
        .filter(
          (c) =>
            !q ||
            c.company_name.toLowerCase().includes(q) ||
            (c.website_url ?? "").toLowerCase().includes(q)
        )
        .map((c) => ({
          id: c.id,
          company_name: c.company_name,
          website_url: c.website_url,
          package: c.package,
          contract_start: c.contract_start,
          contract_end: c.contract_end,
        }));
    },
  }),

  tool({
    name: "get_client",
    title: "Get client",
    description:
      "Full client detail: contact user, CC emails, contract, notes, assigned co-admins, internal customer notes, latest reports and tickets.",
    input: z.object({ client_id: z.string() }),
    readOnly: true,
    async run({ client_id }, { db }) {
      const client = await mustGetClient(db, client_id);
      const [contact, reports, tickets, notes, coAdmins] = await Promise.all([
        db.getUserById(client.user_id),
        db.listReportsByClient(client_id),
        db.listTicketsByClient(client_id),
        db.listCustomerNotes(client_id),
        db.listCoAdminsForClient(client_id),
      ]);
      return {
        ...client,
        cc_emails: parseClientCcEmails(client.cc_emails),
        contact: contact && { name: contact.name, email: contact.email, language: contact.language },
        co_admins: coAdmins.map((u) => ({ id: u.id, name: u.name, email: u.email })),
        customer_notes: notes.map((n) => ({ note: n.note, by: n.user_name, created_at: n.created_at })),
        recent_reports: reports.slice(0, 6).map((r) => ({
          id: r.id,
          year: r.year,
          month: r.month,
          title: r.title,
          status: r.status,
          total_tasks: r.total_tasks,
          client_notified_at: r.client_notified_at,
        })),
        recent_tickets: tickets.slice(0, 10).map((t) => ({
          id: t.id,
          title: t.title,
          status: t.status,
          priority: t.priority,
          updated_at: t.updated_at,
        })),
      };
    },
  }),

  tool({
    name: "list_tickets",
    title: "List tickets",
    description:
      'List support tickets, newest activity first. status may be a ticket status or "unresolved" (open + in_progress + waiting).',
    input: z.object({
      status: z.union([TicketStatus, z.literal("unresolved")]).optional(),
      client_id: z.string().optional(),
      limit: z.number().int().min(1).max(200).default(50),
    }),
    readOnly: true,
    async run({ status, client_id, limit }, { db }) {
      const tickets = await db.listTicketsWithClient(client_id ? [client_id] : undefined);
      return tickets
        .filter((t) =>
          !status ? true : status === "unresolved" ? UNRESOLVED.includes(t.status) : t.status === status
        )
        .slice(0, limit)
        .map((t) => ({
          id: t.id,
          title: t.title,
          company_name: t.company_name,
          client_id: t.client_id,
          status: t.status,
          priority: t.priority,
          created_at: t.created_at,
          updated_at: t.updated_at,
        }));
    },
  }),

  tool({
    name: "get_ticket",
    title: "Get ticket",
    description:
      "A ticket with its full conversation (including internal notes, flagged is_internal) and attachment names.",
    input: z.object({ ticket_id: z.string() }),
    readOnly: true,
    async run({ ticket_id }, { db }) {
      const ticket = await mustGetTicket(db, ticket_id);
      const [client, messages, authors, attachments] = await Promise.all([
        db.getClientById(ticket.client_id),
        db.listMessagesByTicket(ticket_id),
        db.listMessageAuthors(ticket_id),
        db.listAttachmentsByTicket(ticket_id),
      ]);
      const authorById = new Map(authors.map((a) => [a.id, a]));
      return {
        ...ticket,
        company_name: client?.company_name,
        messages: messages.map((m) => ({
          id: m.id,
          author: authorById.get(m.user_id)?.name ?? m.user_id,
          author_role: authorById.get(m.user_id)?.role,
          is_internal: m.is_internal === 1,
          message: m.message,
          attachments: attachments
            .filter((a) => a.message_id === m.id)
            .map((a) => ({ name: a.file_name, mime_type: a.mime_type, size_bytes: a.size_bytes })),
          created_at: m.created_at,
        })),
      };
    },
  }),

  tool({
    name: "reply_ticket",
    title: "Reply to ticket",
    description:
      "Post a message on a ticket as the token's admin. Non-internal replies move an open ticket to in_progress and send the client an in-app + Telegram notification. send_email=true also emails the client — ask the user to confirm before setting it.",
    input: z.object({
      ticket_id: z.string(),
      message: z.string().min(1),
      internal: z.boolean().default(false).describe("Internal note, hidden from the client"),
      send_email: z.boolean().default(false),
    }),
    async run({ ticket_id, message, internal, send_email }, ctx) {
      const { db, env, user } = ctx;
      const ticket = await mustGetTicket(db, ticket_id);
      const messageId = generateId();
      await db.createTicketMessage({
        id: messageId,
        ticket_id,
        user_id: user.id,
        message,
        is_internal: internal ? 1 : 0,
      });
      if (internal) return { ok: true, message_id: messageId, internal: true };

      if (ticket.status === "open") await db.updateTicket(ticket_id, { status: "in_progress" });

      let emailed: string | null = null;
      const client = await db.getClientById(ticket.client_id);
      if (client) {
        const notification = {
          id: generateId(),
          user_id: client.user_id,
          type: "ticket_reply",
          title: `มีข้อความใหม่ใน: ${ticket.title}`,
          body: message.slice(0, 100),
          link: `/tickets/${ticket.id}`,
          read: 0,
        } as const;
        await db.createNotification(notification);
        await sendTelegramNotification({ db, appUrl: env.APP_URL, notification });

        const clientUser = await db.getUserById(client.user_id);
        if (send_email && clientUser?.email && env.SEND_EMAIL) {
          await sendTicketEmailToClient({
            to: clientUser.email,
            toName: clientUser.name,
            cc: parseClientCcEmails(client.cc_emails).map((email) => ({ email })),
            ticketTitle: ticket.title,
            message,
            ticketUrl: `${env.APP_URL}/tickets/${ticket.id}`,
            sendEmail: env.SEND_EMAIL,
            db,
            lang: clientUser.language === "en" ? "en" : "th",
          });
          emailed = clientUser.email;
        }
      }
      return { ok: true, message_id: messageId, emailed };
    },
  }),

  tool({
    name: "update_ticket_status",
    title: "Update ticket status",
    description:
      "Change a ticket's status and notify the client in-app + Telegram. When closing, send_email=true also emails the client — ask the user to confirm before setting it.",
    input: z.object({
      ticket_id: z.string(),
      status: TicketStatus,
      send_email: z.boolean().default(false),
    }),
    async run({ ticket_id, status, send_email }, { db, env }) {
      const ticket = await mustGetTicket(db, ticket_id);
      const update: Partial<SupportTicket> = { status };
      if (status === "resolved") update.resolved_at = now();
      if (status === "open" || status === "in_progress") update.resolved_at = null;
      await db.updateTicket(ticket_id, update);

      let emailed: string | null = null;
      const client = await db.getClientById(ticket.client_id);
      if (client) {
        const notification = {
          id: generateId(),
          user_id: client.user_id,
          type: "ticket_update",
          title: `Ticket อัปเดต: ${ticket.title}`,
          body: `สถานะเปลี่ยนเป็น ${STATUS_LABEL_TH[status]}`,
          link: `/tickets/${ticket.id}`,
          read: 0,
        } as const;
        await db.createNotification(notification);
        await sendTelegramNotification({ db, appUrl: env.APP_URL, notification });

        const clientUser = await db.getUserById(client.user_id);
        if (status === "closed" && send_email && clientUser?.email && env.SEND_EMAIL) {
          await sendTicketClosedEmailToClient({
            to: clientUser.email,
            toName: clientUser.name,
            cc: parseClientCcEmails(client.cc_emails).map((email) => ({ email })),
            ticketTitle: ticket.title,
            ticketUrl: `${env.APP_URL}/tickets/${ticket.id}`,
            sendEmail: env.SEND_EMAIL,
            db,
            lang: clientUser.language === "en" ? "en" : "th",
          });
          emailed = clientUser.email;
        }
      }
      return { ok: true, previous_status: ticket.status, status, emailed };
    },
  }),

  tool({
    name: "create_ticket",
    title: "Create ticket",
    description: "Open a new ticket for a client (created by the token's admin). Does not email anyone.",
    input: z.object({
      client_id: z.string(),
      title: z.string().min(1),
      description: z.string().min(1),
      priority: TicketPriority.default("medium"),
    }),
    async run({ client_id, title, description, priority }, { db, user }) {
      await mustGetClient(db, client_id);
      const id = generateId();
      await db.createTicket({
        id,
        client_id,
        title,
        description,
        priority,
        status: "open",
        created_by: user.id,
        assigned_to: null,
        resolved_at: null,
        deleted_at: null,
        deleted_by: null,
      });
      return { ok: true, ticket_id: id };
    },
  }),

  tool({
    name: "list_reports",
    title: "List reports",
    description: "List monthly reports, newest first. Filter by client and/or year/month.",
    input: z.object({
      client_id: z.string().optional(),
      year: z.number().int().optional(),
      month: z.number().int().min(1).max(12).optional(),
      limit: z.number().int().min(1).max(200).default(50),
    }),
    readOnly: true,
    async run({ client_id, year, month, limit }, { db }) {
      const reports = await db.listRecentReportsWithClient(1000, client_id ? [client_id] : undefined);
      return reports
        .filter((r) => (year == null || r.year === year) && (month == null || r.month === month))
        .sort((a, b) => b.year - a.year || b.month - a.month)
        .slice(0, limit)
        .map((r) => ({
          id: r.id,
          client_id: r.client_id,
          company_name: r.company_name,
          year: r.year,
          month: r.month,
          title: r.title,
          status: r.status,
          total_tasks: r.total_tasks,
          uptime_percent: r.uptime_percent,
          client_notified_at: r.client_notified_at,
        }));
    },
  }),

  tool({
    name: "get_report",
    title: "Get report",
    description: "A monthly report with all of its tasks.",
    input: z.object({ report_id: z.string() }),
    readOnly: true,
    async run({ report_id }, { db }) {
      const report = await db.getReport(report_id);
      if (!report) throw new ToolError(`Report ${report_id} not found`);
      const [client, tasks] = await Promise.all([
        db.getClientById(report.client_id),
        db.listTasksByReport(report_id),
      ]);
      const { client_notification_html: _html, ...rest } = report;
      return { ...rest, company_name: client?.company_name, tasks };
    },
  }),

  tool({
    name: "list_clients_missing_report",
    title: "Clients missing a report",
    description: "Clients with no report yet for the given month. Defaults to the current month (Bangkok time).",
    input: z.object({
      year: z.number().int().optional(),
      month: z.number().int().min(1).max(12).optional(),
    }),
    readOnly: true,
    async run({ year, month }, { db }) {
      const current = bangkokYearMonth();
      const y = year ?? current.year;
      const m = month ?? current.month;
      const clients = await db.listClientsWithoutReportForMonth(y, m);
      return {
        year: y,
        month: m,
        clients: clients.map((c) => ({ id: c.id, company_name: c.company_name, website_url: c.website_url })),
      };
    },
  }),

  tool({
    name: "create_report",
    title: "Create monthly report",
    description:
      "Create a client's monthly report with its tasks. Creates a draft unless publish=true; publishing notifies the client in-app + Telegram but does not email (use send_report_to_client for that).",
    input: z.object({
      client_id: z.string(),
      year: z.number().int().describe("Gregorian year, e.g. 2026"),
      month: z.number().int().min(1).max(12),
      title: z.string().min(1),
      summary: z.string().optional(),
      uptime_percent: z.number().min(0).max(100).optional(),
      speed_score: z.number().min(0).max(100).optional(),
      tasks: z.array(TaskInput).default([]),
      publish: z.boolean().default(false),
    }),
    async run(args, ctx) {
      const { db } = ctx;
      await mustGetClient(db, args.client_id);
      const existing = await db.getReportByMonth(args.client_id, args.year, args.month);
      if (existing) {
        throw new ToolError(
          `Client already has a report for ${args.year}-${args.month} (report_id ${existing.id}); use add_report_tasks or update_report.`
        );
      }
      const id = generateId();
      await db.createReport({
        id,
        client_id: args.client_id,
        year: args.year,
        month: args.month,
        title: args.title,
        summary: args.summary ?? null,
        uptime_percent: args.uptime_percent ?? null,
        speed_score: args.speed_score ?? null,
        total_tasks: args.tasks.length,
        status: args.publish ? "published" : "draft",
        published_at: args.publish ? now() : null,
      });
      for (let i = 0; i < args.tasks.length; i++) {
        await db.createReportTask({
          id: generateId(),
          report_id: id,
          category: args.tasks[i].category as TaskCategory,
          title: args.tasks[i].title,
          description: args.tasks[i].description ?? null,
          completed: 1,
          sort_order: i,
        });
      }
      if (args.publish) await notifyReportPublished(ctx, id, args.client_id, args.year, args.month);
      return { ok: true, report_id: id, status: args.publish ? "published" : "draft" };
    },
  }),

  tool({
    name: "add_report_tasks",
    title: "Add report tasks",
    description: "Append tasks to an existing report.",
    input: z.object({ report_id: z.string(), tasks: z.array(TaskInput).min(1) }),
    async run({ report_id, tasks }, { db }) {
      const report = await db.getReport(report_id);
      if (!report) throw new ToolError(`Report ${report_id} not found`);
      const existing = await db.listTasksByReport(report_id);
      let order = existing.reduce((max, t) => Math.max(max, t.sort_order), -1) + 1;
      for (const t of tasks) {
        await db.createReportTask({
          id: generateId(),
          report_id,
          category: t.category,
          title: t.title,
          description: t.description ?? null,
          completed: 1,
          sort_order: order++,
        });
      }
      const total = existing.length + tasks.length;
      await db.updateReport(report_id, { total_tasks: total });
      return { ok: true, total_tasks: total };
    },
  }),

  tool({
    name: "remove_report_task",
    title: "Remove report task",
    description: "Delete one task from a report.",
    input: z.object({ report_id: z.string(), task_id: z.string() }),
    destructive: true,
    async run({ report_id, task_id }, { db }) {
      const tasks = await db.listTasksByReport(report_id);
      if (!tasks.some((t) => t.id === task_id)) {
        throw new ToolError(`Task ${task_id} is not in report ${report_id}`);
      }
      await db.deleteReportTask(task_id);
      await db.updateReport(report_id, { total_tasks: tasks.length - 1 });
      return { ok: true, total_tasks: tasks.length - 1 };
    },
  }),

  tool({
    name: "update_report",
    title: "Update report",
    description:
      "Edit a report's title, summary, uptime or speed score, or publish/unpublish it. Publishing notifies the client in-app + Telegram but does not email.",
    input: z.object({
      report_id: z.string(),
      title: z.string().min(1).optional(),
      summary: z.string().optional(),
      uptime_percent: z.number().min(0).max(100).optional(),
      speed_score: z.number().min(0).max(100).optional(),
      status: z.enum(["draft", "published"]).optional(),
    }),
    async run({ report_id, status, ...fields }, ctx) {
      const report = await ctx.db.getReport(report_id);
      if (!report) throw new ToolError(`Report ${report_id} not found`);
      const update: Record<string, unknown> = Object.fromEntries(
        Object.entries(fields).filter(([, v]) => v !== undefined)
      );
      const publishing = status === "published" && report.status !== "published";
      if (status) update.status = status;
      if (publishing) update.published_at = now();
      if (Object.keys(update).length === 0) return { ok: true, changed: false };
      await ctx.db.updateReport(report_id, update);
      if (publishing) {
        await notifyReportPublished(ctx, report_id, report.client_id, report.year, report.month);
      }
      return { ok: true, changed: true, status: status ?? report.status };
    },
  }),

  tool({
    name: "send_report_to_client",
    title: "Email report to client",
    description:
      "Email a published report link to the client contact (and CCs) and ping co-admin Telegram groups. Sends real email: always show the user which client and report, and get explicit confirmation before calling.",
    input: z.object({
      report_id: z.string(),
      confirm: z.literal(true).describe("Must be true; only set after the user confirmed sending"),
    }),
    destructive: true,
    async run({ report_id }, { env, db, origin }) {
      const result = await notifyReportToClient({ env, db, reportId: report_id, origin });
      if (!result.ok) {
        throw new ToolError(
          result.error === "not_found"
            ? "Report not found or not published yet — publish it with update_report first"
            : `${result.error}${result.message ? `: ${result.message}` : ""}`
        );
      }
      return result;
    },
  }),

  tool({
    name: "list_email_logs",
    title: "List email logs",
    description: "Recent outgoing emails (recipient, subject, source, status, error).",
    input: z.object({ limit: z.number().int().min(1).max(200).default(30) }),
    readOnly: true,
    async run({ limit }, { db }) {
      return (await db.listEmailLogs(limit)).map(({ html_body: _h, text_body: _t, ...log }) => log);
    },
  }),
];
