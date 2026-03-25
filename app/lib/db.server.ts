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
          "INSERT INTO users (id, email, name, role, avatar_url) VALUES (?, ?, ?, ?, ?)"
        )
        .bind(user.id, user.email, user.name, user.role, user.avatar_url)
        .run();
    },

    async updateUser(
      id: string,
      data: Partial<Pick<User, "name" | "avatar_url">>
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
        .prepare("SELECT * FROM clients WHERE user_id = ?")
        .bind(user_id)
        .first<Client>();
    },

    async getClientById(id: string): Promise<Client | null> {
      return d1
        .prepare("SELECT * FROM clients WHERE id = ?")
        .bind(id)
        .first<Client>();
    },

    async listClients(): Promise<Client[]> {
      const result = await d1
        .prepare("SELECT * FROM clients ORDER BY company_name")
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
  };
}

export type DB = ReturnType<typeof createDB>;
