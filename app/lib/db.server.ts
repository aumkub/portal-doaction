import type {
  User,
  Session,
  Client,
  MonthlyReport,
  ReportTask,
  SupportTicket,
  TicketMessage,
  Notification,
  MagicLinkToken,
  TicketAttachment,
  EmailLog,
} from "~/types";

// ─── DB wrapper ───────────────────────────────────────────────────────────────

export function createDB(d1: D1Database) {
  return {
    // ── Users ────────────────────────────────────────────────────────────────

    async getUserById(id: string): Promise<User | null> {
      return d1
        .prepare("SELECT * FROM users WHERE id = ?")
        .bind(id)
        .first<User>();
    },

    async getUserByEmail(email: string): Promise<User | null> {
      return d1
        .prepare("SELECT * FROM users WHERE email = ?")
        .bind(email)
        .first<User>();
    },

    async createUser(
      user: Omit<User, "created_at" | "updated_at">
    ): Promise<void> {
      await d1
        .prepare(
          "INSERT INTO users (id, email, name, role, avatar_url, first_login_at) VALUES (?, ?, ?, ?, ?, ?)"
        )
        .bind(
          user.id,
          user.email,
          user.name,
          user.role,
          user.avatar_url,
          user.first_login_at ?? null
        )
        .run();
    },

    async updateUser(
      id: string,
      data: Partial<Pick<User, "name" | "email" | "avatar_url" | "language" | "first_login_at">>
    ): Promise<void> {
      const fields = Object.keys(data)
        .map((k) => `${k} = ?`)
        .join(", ");
      const values = Object.values(data);
      await d1
        .prepare(
          `UPDATE users SET ${fields}, updated_at = unixepoch() WHERE id = ?`
        )
        .bind(...values, id)
        .run();
    },

    async listAdminUsers(): Promise<User[]> {
      const result = await d1
        .prepare("SELECT * FROM users WHERE role = 'admin' ORDER BY name")
        .all<User>();
      return result.results;
    },

    // ── Sessions ─────────────────────────────────────────────────────────────

    async getSession(id: string): Promise<Session | null> {
      return d1
        .prepare("SELECT * FROM sessions WHERE id = ?")
        .bind(id)
        .first<Session>();
    },

    async createSession(session: Session): Promise<void> {
      await d1
        .prepare(
          "INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)"
        )
        .bind(session.id, session.user_id, session.expires_at)
        .run();
    },

    async deleteSession(id: string): Promise<void> {
      await d1.prepare("DELETE FROM sessions WHERE id = ?").bind(id).run();
    },

    async deleteExpiredSessions(): Promise<void> {
      await d1
        .prepare("DELETE FROM sessions WHERE expires_at < unixepoch()")
        .run();
    },

    async updateSessionExpiry(id: string, expires_at: number): Promise<void> {
      await d1
        .prepare("UPDATE sessions SET expires_at = ? WHERE id = ?")
        .bind(expires_at, id)
        .run();
    },

    // ── Magic Link Tokens ────────────────────────────────────────────────────

    async createMagicLinkToken(token: MagicLinkToken): Promise<void> {
      await d1
        .prepare(
          "INSERT INTO magic_link_tokens (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)"
        )
        .bind(token.id, token.user_id, token.token, token.expires_at)
        .run();
    },

    async getMagicLinkToken(token: string): Promise<MagicLinkToken | null> {
      return d1
        .prepare(
          "SELECT * FROM magic_link_tokens WHERE token = ? AND used = 0 AND expires_at > unixepoch()"
        )
        .bind(token)
        .first<MagicLinkToken>();
    },

    async markMagicLinkUsed(id: string): Promise<void> {
      await d1
        .prepare("UPDATE magic_link_tokens SET used = 1 WHERE id = ?")
        .bind(id)
        .run();
    },

    // ── Clients ───────────────────────────────────────────────────────────────

    async getClientByUserId(user_id: string): Promise<Client | null> {
      return d1
        .prepare("SELECT * FROM clients WHERE user_id = ? AND deleted_at IS NULL")
        .bind(user_id)
        .first<Client>();
    },

    async getClientById(id: string): Promise<Client | null> {
      return d1
        .prepare("SELECT * FROM clients WHERE id = ? AND deleted_at IS NULL")
        .bind(id)
        .first<Client>();
    },

    async listClients(): Promise<Client[]> {
      const result = await d1
        .prepare("SELECT * FROM clients WHERE deleted_at IS NULL ORDER BY company_name")
        .all<Client>();
      return result.results;
    },

    async createClient(
      client: Omit<Client, "created_at">
    ): Promise<void> {
      await d1
        .prepare(
          `INSERT INTO clients (id, user_id, company_name, website_url, package, contract_start, contract_end, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          client.id,
          client.user_id,
          client.company_name,
          client.website_url,
          client.package,
          client.contract_start,
          client.contract_end,
          client.notes
        )
        .run();
    },

    async updateClient(
      id: string,
      data: Partial<Omit<Client, "id" | "user_id" | "created_at">>
    ): Promise<void> {
      const fields = Object.keys(data)
        .map((k) => `${k} = ?`)
        .join(", ");
      const values = Object.values(data);
      await d1
        .prepare(`UPDATE clients SET ${fields} WHERE id = ?`)
        .bind(...values, id)
        .run();
    },

    async softDeleteClient(id: string): Promise<void> {
      await d1
        .prepare("UPDATE clients SET deleted_at = unixepoch() WHERE id = ?")
        .bind(id)
        .run();
    },

    // ── Monthly Reports ───────────────────────────────────────────────────────

    async listReportsByClient(client_id: string): Promise<MonthlyReport[]> {
      const result = await d1
        .prepare(
          "SELECT * FROM monthly_reports WHERE client_id = ? ORDER BY year DESC, month DESC"
        )
        .bind(client_id)
        .all<MonthlyReport>();
      return result.results;
    },

    async getReport(id: string): Promise<MonthlyReport | null> {
      return d1
        .prepare("SELECT * FROM monthly_reports WHERE id = ?")
        .bind(id)
        .first<MonthlyReport>();
    },

    async getReportByMonth(
      client_id: string,
      year: number,
      month: number
    ): Promise<MonthlyReport | null> {
      return d1
        .prepare(
          "SELECT * FROM monthly_reports WHERE client_id = ? AND year = ? AND month = ?"
        )
        .bind(client_id, year, month)
        .first<MonthlyReport>();
    },

    async createReport(
      report: Omit<MonthlyReport, "created_at">
    ): Promise<void> {
      await d1
        .prepare(
          `INSERT INTO monthly_reports
             (id, client_id, year, month, title, summary, uptime_percent, speed_score, total_tasks, status, published_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          report.id,
          report.client_id,
          report.year,
          report.month,
          report.title,
          report.summary,
          report.uptime_percent,
          report.speed_score,
          report.total_tasks,
          report.status,
          report.published_at
        )
        .run();
    },

    async updateReport(
      id: string,
      data: Partial<Omit<MonthlyReport, "id" | "client_id" | "created_at">>
    ): Promise<void> {
      const fields = Object.keys(data)
        .map((k) => `${k} = ?`)
        .join(", ");
      const values = Object.values(data);
      await d1
        .prepare(`UPDATE monthly_reports SET ${fields} WHERE id = ?`)
        .bind(...values, id)
        .run();
    },

    // ── Report Tasks ──────────────────────────────────────────────────────────

    async listTasksByReport(report_id: string): Promise<ReportTask[]> {
      const result = await d1
        .prepare(
          "SELECT * FROM report_tasks WHERE report_id = ? ORDER BY sort_order"
        )
        .bind(report_id)
        .all<ReportTask>();
      return result.results;
    },

    async createReportTask(task: ReportTask): Promise<void> {
      await d1
        .prepare(
          `INSERT INTO report_tasks (id, report_id, category, title, description, completed, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          task.id,
          task.report_id,
          task.category,
          task.title,
          task.description,
          task.completed,
          task.sort_order
        )
        .run();
    },

    async deleteReportTask(id: string): Promise<void> {
      await d1
        .prepare("DELETE FROM report_tasks WHERE id = ?")
        .bind(id)
        .run();
    },

    // ── Support Tickets ───────────────────────────────────────────────────────

    async listTicketsByClient(client_id: string): Promise<SupportTicket[]> {
      const result = await d1
        .prepare(
          "SELECT * FROM support_tickets WHERE client_id = ? ORDER BY created_at DESC"
        )
        .bind(client_id)
        .all<SupportTicket>();
      return result.results;
    },

    async listAllOpenTickets(): Promise<(SupportTicket & { company_name: string })[]> {
      const result = await d1
        .prepare(
          `SELECT st.*, c.company_name
           FROM support_tickets st
           LEFT JOIN clients c ON c.id = st.client_id
           WHERE st.status IN ('open', 'in_progress', 'waiting')
             AND (c.deleted_at IS NULL OR c.deleted_at = 0)
           ORDER BY st.created_at ASC`
        )
        .all<SupportTicket & { company_name: string }>();
      return result.results;
    },

    async getTicket(id: string): Promise<SupportTicket | null> {
      return d1
        .prepare("SELECT * FROM support_tickets WHERE id = ?")
        .bind(id)
        .first<SupportTicket>();
    },

    async createTicket(
      ticket: Omit<SupportTicket, "created_at" | "updated_at">
    ): Promise<void> {
      await d1
        .prepare(
          `INSERT INTO support_tickets
             (id, client_id, title, description, priority, status, created_by, assigned_to, resolved_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          ticket.id,
          ticket.client_id,
          ticket.title,
          ticket.description,
          ticket.priority,
          ticket.status,
          ticket.created_by,
          ticket.assigned_to,
          ticket.resolved_at
        )
        .run();
    },

    async updateTicket(
      id: string,
      data: Partial<
        Omit<SupportTicket, "id" | "client_id" | "created_by" | "created_at">
      >
    ): Promise<void> {
      const fields = Object.keys(data)
        .map((k) => `${k} = ?`)
        .join(", ");
      const values = Object.values(data);
      await d1
        .prepare(
          `UPDATE support_tickets SET ${fields}, updated_at = unixepoch() WHERE id = ?`
        )
        .bind(...values, id)
        .run();
    },

    // ── Ticket Messages ───────────────────────────────────────────────────────

    async listMessagesByTicket(ticket_id: string): Promise<TicketMessage[]> {
      const result = await d1
        .prepare(
          "SELECT * FROM ticket_messages WHERE ticket_id = ? ORDER BY created_at ASC"
        )
        .bind(ticket_id)
        .all<TicketMessage>();
      return result.results;
    },

    async createTicketMessage(
      msg: Omit<TicketMessage, "created_at">
    ): Promise<void> {
      await d1
        .prepare(
          "INSERT INTO ticket_messages (id, ticket_id, user_id, message, is_internal) VALUES (?, ?, ?, ?, ?)"
        )
        .bind(msg.id, msg.ticket_id, msg.user_id, msg.message, msg.is_internal)
        .run();
    },

    async createTicketAttachment(
      attachment: Omit<TicketAttachment, "created_at">
    ): Promise<void> {
      await d1
        .prepare(
          `INSERT INTO ticket_attachments
            (id, ticket_id, message_id, uploader_user_id, file_key, file_name, mime_type, size_bytes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          attachment.id,
          attachment.ticket_id,
          attachment.message_id,
          attachment.uploader_user_id,
          attachment.file_key,
          attachment.file_name,
          attachment.mime_type,
          attachment.size_bytes
        )
        .run();
    },

    async listAttachmentsByTicket(ticket_id: string): Promise<TicketAttachment[]> {
      const result = await d1
        .prepare(
          "SELECT * FROM ticket_attachments WHERE ticket_id = ? ORDER BY created_at ASC"
        )
        .bind(ticket_id)
        .all<TicketAttachment>();
      return result.results;
    },

    async getTicketAttachmentByKey(file_key: string): Promise<TicketAttachment | null> {
      return d1
        .prepare("SELECT * FROM ticket_attachments WHERE file_key = ?")
        .bind(file_key)
        .first<TicketAttachment>();
    },

    async getTicketAttachmentById(id: string): Promise<TicketAttachment | null> {
      return d1
        .prepare("SELECT * FROM ticket_attachments WHERE id = ?")
        .bind(id)
        .first<TicketAttachment>();
    },

    async deleteTicketAttachment(id: string): Promise<void> {
      await d1.prepare("DELETE FROM ticket_attachments WHERE id = ?").bind(id).run();
    },

    async listAllTicketAttachments(): Promise<
      Array<
        TicketAttachment & {
          ticket_title: string;
          message_text: string | null;
          uploader_name: string;
        }
      >
    > {
      const result = await d1
        .prepare(
          `SELECT
             a.*,
             t.title AS ticket_title,
             m.message AS message_text,
             u.name AS uploader_name
           FROM ticket_attachments a
           JOIN support_tickets t ON t.id = a.ticket_id
           LEFT JOIN ticket_messages m ON m.id = a.message_id
           JOIN users u ON u.id = a.uploader_user_id
           ORDER BY a.created_at DESC`
        )
        .all<
          TicketAttachment & {
            ticket_title: string;
            message_text: string | null;
            uploader_name: string;
          }
        >();
      return result.results;
    },

    // ── Notifications ─────────────────────────────────────────────────────────

    async listNotifications(
      user_id: string,
      unreadOnly = false
    ): Promise<Notification[]> {
      const query = unreadOnly
        ? "SELECT * FROM notifications WHERE user_id = ? AND read = 0 ORDER BY created_at DESC"
        : "SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50";
      const result = await d1
        .prepare(query)
        .bind(user_id)
        .all<Notification>();
      return result.results;
    },

    async listNotificationsAll(user_id: string): Promise<Notification[]> {
      const result = await d1
        .prepare("SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC")
        .bind(user_id)
        .all<Notification>();
      return result.results;
    },

    async markNotificationRead(id: string): Promise<void> {
      await d1
        .prepare("UPDATE notifications SET read = 1 WHERE id = ?")
        .bind(id)
        .run();
    },

    async markAllNotificationsRead(user_id: string): Promise<void> {
      await d1
        .prepare("UPDATE notifications SET read = 1 WHERE user_id = ?")
        .bind(user_id)
        .run();
    },

    async getNotificationById(id: string): Promise<Notification | null> {
      return d1
        .prepare("SELECT * FROM notifications WHERE id = ?")
        .bind(id)
        .first<Notification>();
    },

    async createNotification(
      notif: Omit<Notification, "created_at">
    ): Promise<void> {
      await d1
        .prepare(
          "INSERT INTO notifications (id, user_id, type, title, body, link, read) VALUES (?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(
          notif.id,
          notif.user_id,
          notif.type,
          notif.title,
          notif.body,
          notif.link,
          notif.read
        )
        .run();
    },

    // ── App Settings ──────────────────────────────────────────────────────────

    async getAppSetting(key: string): Promise<string | null> {
      const row = await d1
        .prepare("SELECT value FROM app_settings WHERE key = ?")
        .bind(key)
        .first<{ value: string }>();
      return row?.value ?? null;
    },

    async setAppSetting(key: string, value: string): Promise<void> {
      await d1
        .prepare(
          `INSERT INTO app_settings (key, value, updated_at)
           VALUES (?, ?, unixepoch())
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = unixepoch()`
        )
        .bind(key, value)
        .run();
    },

    async deleteAppSetting(key: string): Promise<void> {
      await d1.prepare("DELETE FROM app_settings WHERE key = ?").bind(key).run();
    },

    async createEmailLog(log: {
      id: string;
      to_email: string;
      to_name?: string | null;
      subject: string;
      html_body: string;
      text_body: string;
      source?: string | null;
      status?: "sent" | "failed";
      error_message?: string | null;
    }): Promise<void> {
      await d1
        .prepare(
          `INSERT INTO email_logs
            (id, to_email, to_name, subject, html_body, text_body, source, status, error_message)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          log.id,
          log.to_email,
          log.to_name ?? null,
          log.subject,
          log.html_body,
          log.text_body,
          log.source ?? null,
          log.status ?? "sent",
          log.error_message ?? null
        )
        .run();
    },

    async listEmailLogs(limit = 200): Promise<EmailLog[]> {
      const result = await d1
        .prepare("SELECT * FROM email_logs ORDER BY created_at DESC LIMIT ?")
        .bind(limit)
        .all<EmailLog>();
      return result.results;
    },

    async hasContractWarningLog(
      client_id: string,
      warning_stage: "first" | "second" | "third",
      contract_end: string
    ): Promise<boolean> {
      const row = await d1
        .prepare(
          "SELECT id FROM contract_warning_logs WHERE client_id = ? AND warning_stage = ? AND contract_end = ?"
        )
        .bind(client_id, warning_stage, contract_end)
        .first<{ id: string }>();
      return Boolean(row?.id);
    },

    async createContractWarningLog(params: {
      id: string;
      client_id: string;
      warning_stage: "first" | "second" | "third";
      contract_end: string;
    }): Promise<void> {
      await d1
        .prepare(
          `INSERT INTO contract_warning_logs
            (id, client_id, warning_stage, contract_end)
           VALUES (?, ?, ?, ?)`
        )
        .bind(params.id, params.client_id, params.warning_stage, params.contract_end)
        .run();
    },
  };
}

export type DB = ReturnType<typeof createDB>;
