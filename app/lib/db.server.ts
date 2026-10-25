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
  CoAdminClient,
  CustomerNote,
  CustomerNoteWithUser,
  MessageAuthor,
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
          "INSERT INTO users (id, email, name, role, team_type, password_hash, avatar_url, first_login_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())"
        )
        .bind(
          user.id,
          user.email,
          user.name,
          user.role,
          user.team_type ?? "co-admin",
          user.password_hash ?? null,
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

    async listCoAdminUsers(): Promise<User[]> {
      const result = await d1
        .prepare("SELECT * FROM users WHERE role = 'co-admin' ORDER BY name")
        .all<User>();
      return result.results;
    },

    async updateUserPasswordHash(id: string, password_hash: string): Promise<void> {
      await d1
        .prepare("UPDATE users SET password_hash = ?, updated_at = unixepoch() WHERE id = ?")
        .bind(password_hash, id)
        .run();
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
      client: Omit<Client, "created_at" | "sso_enabled" | "ticket_block" | "deleted_at">
    ): Promise<void> {
      await d1
        .prepare(
          `INSERT INTO clients (id, user_id, company_name, website_url, cc_emails, package, contract_start, contract_end, notes, kind)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          client.id,
          client.user_id,
          client.company_name,
          client.website_url,
          client.cc_emails ?? null,
          client.package,
          client.contract_start,
          client.contract_end,
          client.notes,
          client.kind
        )
        .run();
    },

    async setClientKind(id: string, kind: Client["kind"]): Promise<void> {
      await d1.prepare("UPDATE clients SET kind = ? WHERE id = ?").bind(kind, id).run();
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

    /**
     * Tickets still waiting on the team (not resolved or closed). Pass a
     * co-admin id to count only their assigned clients.
     */
    async countUnresolvedTickets(coAdminId: string | null): Promise<number> {
      const row = await d1
        .prepare(
          `SELECT COUNT(*) AS n
           FROM support_tickets t
           JOIN clients c ON c.id = t.client_id
           WHERE t.deleted_at IS NULL AND c.deleted_at IS NULL
             AND t.status IN ('open', 'in_progress', 'waiting')
             AND (? IS NULL OR t.client_id IN (
               SELECT client_id FROM co_admin_clients WHERE co_admin_id = ?
             ))`
        )
        .bind(coAdminId, coAdminId)
        .first<{ n: number }>();
      return row?.n ?? 0;
    },

    /** All tickets joined with their client's company name. */
    async listTicketsWithClient(
      clientIds?: string[]
    ): Promise<(SupportTicket & { company_name: string })[]> {
      if (clientIds && clientIds.length === 0) return [];
      const filter = clientIds
        ? `AND t.client_id IN (${clientIds.map(() => "?").join(",")})`
        : "";
      const result = await d1
        .prepare(
          `SELECT t.*, c.company_name
           FROM support_tickets t
           JOIN clients c ON c.id = t.client_id
           WHERE t.deleted_at IS NULL AND c.deleted_at IS NULL ${filter}
           ORDER BY t.updated_at DESC`
        )
        .bind(...(clientIds ?? []))
        .all<SupportTicket & { company_name: string }>();
      return result.results;
    },

    /**
     * Latest `perClient` reports for every client, joined with company and
     * contact details. Replaces a per-client query loop.
     */
    async listRecentReportsWithClient(
      perClient: number,
      clientIds?: string[]
    ): Promise<
      (MonthlyReport & {
        company_name: string;
        client_email: string;
        client_contact_name: string;
      })[]
    > {
      if (clientIds && clientIds.length === 0) return [];
      const filter = clientIds
        ? `AND r.client_id IN (${clientIds.map(() => "?").join(",")})`
        : "";
      const result = await d1
        .prepare(
          `SELECT * FROM (
             SELECT r.*, c.company_name,
                    COALESCE(u.email, '') AS client_email,
                    COALESCE(u.name, '') AS client_contact_name,
                    ROW_NUMBER() OVER (
                      PARTITION BY r.client_id ORDER BY r.year DESC, r.month DESC
                    ) AS rn
             FROM monthly_reports r
             JOIN clients c ON c.id = r.client_id
             LEFT JOIN users u ON u.id = c.user_id
             WHERE c.deleted_at IS NULL ${filter}
           ) WHERE rn <= ?
           ORDER BY created_at DESC`
        )
        .bind(...(clientIds ?? []), perClient)
        .all<
          MonthlyReport & {
            company_name: string;
            client_email: string;
            client_contact_name: string;
          }
        >();
      return result.results;
    },

    async listClientsWithoutReportForMonth(
      year: number,
      month: number
    ): Promise<(Client & { user_email: string; user_name: string })[]> {
      const result = await d1
        .prepare(`
          SELECT c.*, u.email as user_email, u.name as user_name
          FROM clients c
          JOIN users u ON u.id = c.user_id
          WHERE c.deleted_at IS NULL
            -- Expired contracts and internal websites get no monthly report
            -- (keep in sync with needsMonthlyReport in app/lib/contract.ts)
            AND (c.contract_end IS NULL OR c.contract_end = ''
                 OR c.contract_end >= date('now', '+7 hours'))
            AND c.kind = 'client'
            AND c.id NOT IN (
              SELECT client_id FROM monthly_reports
              WHERE year = ? AND month = ?
            )
          ORDER BY c.company_name
        `)
        .bind(year, month)
        .all<(Client & { user_email: string; user_name: string })>();
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
          "SELECT * FROM support_tickets WHERE client_id = ? AND deleted_at IS NULL ORDER BY created_at DESC"
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
             AND st.deleted_at IS NULL
             AND (c.deleted_at IS NULL OR c.deleted_at = 0)
           ORDER BY st.created_at ASC`
        )
        .all<SupportTicket & { company_name: string }>();
      return result.results;
    },

    async listTrashedTickets(): Promise<(SupportTicket & { company_name: string })[]> {
      const result = await d1
        .prepare(
          `SELECT st.*, c.company_name
           FROM support_tickets st
           LEFT JOIN clients c ON c.id = st.client_id
           WHERE st.deleted_at IS NOT NULL
           ORDER BY st.deleted_at DESC`
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

    /**
     * Everyone who has written in the ticket, limited to the columns the
     * conversation view renders — this map is serialized to the browser, so
     * it must never carry email or password_hash.
     */
    async listMessageAuthors(ticket_id: string): Promise<MessageAuthor[]> {
      const result = await d1
        .prepare(
          `SELECT id, name, role, avatar_url FROM users
           WHERE id IN (SELECT DISTINCT user_id FROM ticket_messages WHERE ticket_id = ?)`
        )
        .bind(ticket_id)
        .all<MessageAuthor>();
      return result.results;
    },

    async getTicketMessage(id: string): Promise<TicketMessage | null> {
      return d1
        .prepare("SELECT * FROM ticket_messages WHERE id = ?")
        .bind(id)
        .first<TicketMessage>();
    },

    async listReactionsByTicket(ticket_id: string) {
      const result = await d1
        .prepare(
          `SELECT r.message_id, r.user_id, r.reaction, u.name
           FROM ticket_message_reactions r
           LEFT JOIN users u ON u.id = r.user_id
           WHERE r.ticket_id = ?
           ORDER BY r.created_at`
        )
        .bind(ticket_id)
        .all<{ message_id: string; user_id: string; reaction: string; name: string | null }>();
      return result.results;
    },

    /** Adds the reaction, or removes it if this user already gave it. */
    async toggleReaction(r: { message_id: string; ticket_id: string; user_id: string; reaction: string }) {
      const removed = await d1
        .prepare("DELETE FROM ticket_message_reactions WHERE message_id = ? AND user_id = ? AND reaction = ?")
        .bind(r.message_id, r.user_id, r.reaction)
        .run();
      if (removed.meta.changes > 0) return;
      await d1
        .prepare(
          "INSERT OR IGNORE INTO ticket_message_reactions (message_id, ticket_id, user_id, reaction) VALUES (?, ?, ?, ?)"
        )
        .bind(r.message_id, r.ticket_id, r.user_id, r.reaction)
        .run();
    },

    /** Deletes a message and its attachment rows; returns the R2 keys to purge. */
    async deleteTicketMessage(id: string): Promise<string[]> {
      const keys = await d1
        .prepare("SELECT file_key FROM ticket_attachments WHERE message_id = ?")
        .bind(id)
        .all<{ file_key: string }>();
      await d1.batch([
        d1.prepare("DELETE FROM ticket_attachments WHERE message_id = ?").bind(id),
        d1.prepare("DELETE FROM ticket_message_reactions WHERE message_id = ?").bind(id),
        d1.prepare("DELETE FROM ticket_messages WHERE id = ?").bind(id),
      ]);
      return keys.results.map((r) => r.file_key);
    },

    async createTicketMessage(
      msg: Omit<TicketMessage, "created_at">
    ): Promise<void> {
      await d1
        .prepare(
          "INSERT INTO ticket_messages (id, ticket_id, user_id, message, is_internal, reply_to_id) VALUES (?, ?, ?, ?, ?, ?)"
        )
        .bind(msg.id, msg.ticket_id, msg.user_id, msg.message, msg.is_internal, msg.reply_to_id ?? null)
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

    async softDeleteTicket(id: string, deletedBy: string): Promise<void> {
      await d1
        .prepare("UPDATE support_tickets SET deleted_at = unixepoch(), deleted_by = ? WHERE id = ?")
        .bind(deletedBy, id)
        .run();
    },

    async restoreTicket(id: string): Promise<void> {
      await d1
        .prepare("UPDATE support_tickets SET deleted_at = NULL, deleted_by = NULL WHERE id = ?")
        .bind(id)
        .run();
    },

    async permanentlyDeleteTicket(id: string): Promise<void> {
      await d1.prepare("DELETE FROM ticket_messages WHERE ticket_id = ?").bind(id).run();
      await d1.prepare("DELETE FROM ticket_attachments WHERE ticket_id = ?").bind(id).run();
      await d1.prepare("DELETE FROM support_tickets WHERE id = ?").bind(id).run();
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

    /** Reads many settings in one round trip; missing keys come back null. */
    async getAppSettings(keys: string[]): Promise<Record<string, string | null>> {
      const out: Record<string, string | null> = {};
      for (const k of keys) out[k] = null;
      if (keys.length === 0) return out;
      const result = await d1
        .prepare(
          `SELECT key, value FROM app_settings WHERE key IN (${keys.map(() => "?").join(",")})`
        )
        .bind(...keys)
        .all<{ key: string; value: string }>();
      for (const row of result.results) out[row.key] = row.value;
      return out;
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

    // ── Co-Admin Clients (Many-to-Many) ────────────────────────────────────────

    async listCoAdminClients(co_admin_id: string): Promise<(CoAdminClient & { telegram_group_id: string | null })[]> {
      const result = await d1
        .prepare("SELECT * FROM co_admin_clients WHERE co_admin_id = ?")
        .bind(co_admin_id)
        .all<CoAdminClient & { telegram_group_id: string | null }>();
      return result.results;
    },

    async listCoAdminsForClient(client_id: string): Promise<(User & { telegram_group_id: string | null })[]> {
      const result = await d1
        .prepare(`
          SELECT u.*, cac.telegram_group_id FROM users u
          INNER JOIN co_admin_clients cac ON u.id = cac.co_admin_id
          WHERE cac.client_id = ? AND u.role = 'co-admin'
          ORDER BY u.name
        `)
        .bind(client_id)
        .all<(User & { telegram_group_id: string | null })>();
      return result.results;
    },

    async addCoAdminClient(
      co_admin_id: string,
      client_id: string,
      telegram_group_id?: string | null
    ): Promise<void> {
      const id = crypto.randomUUID();
      await d1
        .prepare(
          "INSERT INTO co_admin_clients (id, co_admin_id, client_id, telegram_group_id) VALUES (?, ?, ?, ?)"
        )
        .bind(id, co_admin_id, client_id, telegram_group_id ?? null)
        .run();
    },

    async removeCoAdminClient(co_admin_id: string, client_id: string): Promise<void> {
      await d1
        .prepare("DELETE FROM co_admin_clients WHERE co_admin_id = ? AND client_id = ?")
        .bind(co_admin_id, client_id)
        .run();
    },

    async removeAllCoAdminAssignments(co_admin_id: string): Promise<void> {
      await d1
        .prepare("DELETE FROM co_admin_clients WHERE co_admin_id = ?")
        .bind(co_admin_id)
        .run();
    },

    async updateCoAdminClientTelegramGroup(
      co_admin_id: string,
      client_id: string,
      telegram_group_id: string | null
    ): Promise<void> {
      await d1
        .prepare("UPDATE co_admin_clients SET telegram_group_id = ? WHERE co_admin_id = ? AND client_id = ?")
        .bind(telegram_group_id, co_admin_id, client_id)
        .run();
    },

    async getCoAdminClientTelegramGroup(
      co_admin_id: string,
      client_id: string
    ): Promise<string | null> {
      const row = await d1
        .prepare("SELECT telegram_group_id FROM co_admin_clients WHERE co_admin_id = ? AND client_id = ?")
        .bind(co_admin_id, client_id)
        .first<{ telegram_group_id: string | null }>();
      return row?.telegram_group_id ?? null;
    },

    // ── Customer Notes ──────────────────────────────────────────────────────────

    async listCustomerNotes(client_id: string): Promise<CustomerNoteWithUser[]> {
      const result = await d1
        .prepare(`
          SELECT cn.*, u.name as user_name, u.role as user_role
          FROM customer_notes cn
          JOIN users u ON u.id = cn.user_id
          WHERE cn.client_id = ?
          ORDER BY cn.created_at DESC
        `)
        .bind(client_id)
        .all<CustomerNoteWithUser>();
      return result.results;
    },

    async createCustomerNote(note: Omit<CustomerNote, "created_at" | "updated_at">): Promise<void> {
      await d1
        .prepare(
          "INSERT INTO customer_notes (id, client_id, user_id, note) VALUES (?, ?, ?, ?)"
        )
        .bind(note.id, note.client_id, note.user_id, note.note)
        .run();
    },

    async deleteCustomerNote(id: string): Promise<void> {
      await d1
        .prepare("DELETE FROM customer_notes WHERE id = ?")
        .bind(id)
        .run();
    },

    async getCustomerNoteById(id: string): Promise<CustomerNote | null> {
      return d1
        .prepare("SELECT * FROM customer_notes WHERE id = ?")
        .bind(id)
        .first<CustomerNote>();
    },

    async getCoAdminEmailsForClient(client_id: string): Promise<Array<{ email: string; name: string }>> {
      const result = await d1
        .prepare(`
          SELECT u.email, u.name
          FROM users u
          INNER JOIN co_admin_clients cac ON u.id = cac.co_admin_id
          WHERE cac.client_id = ? AND u.role = 'co-admin'
        `)
        .bind(client_id)
        .all<{ email: string; name: string }>();
      return result.results;
    },

    // ── Email Logs ─────────────────────────────────────────────────────────────

    async createEmailLog(log: {
      id: string;
      to_email: string;
      to_name?: string | null;
      cc_emails?: string | null;
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
            (id, to_email, to_name, cc_emails, subject, html_body, text_body, source, status, error_message)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          log.id,
          log.to_email,
          log.to_name ?? null,
          log.cc_emails ?? null,
          log.subject,
          log.html_body,
          log.text_body,
          log.source ?? null,
          log.status ?? "sent",
          log.error_message ?? null
        )
        .run();
    },

    async getEmailLog(id: string): Promise<EmailLog | null> {
      return d1.prepare("SELECT * FROM email_logs WHERE id = ?").bind(id).first<EmailLog>();
    },

    async listEmailLogs(limit = 200): Promise<EmailLog[]> {
      const result = await d1
        .prepare("SELECT * FROM email_logs ORDER BY created_at DESC LIMIT ?")
        .bind(limit)
        .all<EmailLog>();
      return result.results;
    },

    // ── Monthly care marks (admin only) ─────────────────────────────────────

    async listMonthlyCare(
      year: number,
      month: number
    ): Promise<Array<{ client_id: string; checked_at: number; checked_by_name: string }>> {
      const result = await d1
        .prepare(
          `SELECT m.client_id, m.checked_at, COALESCE(u.name, '') AS checked_by_name
           FROM client_monthly_care m LEFT JOIN users u ON u.id = m.checked_by
           WHERE m.year = ? AND m.month = ?`
        )
        .bind(year, month)
        .all<{ client_id: string; checked_at: number; checked_by_name: string }>();
      return result.results;
    },

    async setMonthlyCare(client_id: string, year: number, month: number, checked_by: string): Promise<void> {
      await d1
        .prepare(
          `INSERT INTO client_monthly_care (client_id, year, month, checked_by) VALUES (?, ?, ?, ?)
           ON CONFLICT (client_id, year, month) DO NOTHING`
        )
        .bind(client_id, year, month, checked_by)
        .run();
    },

    async clearMonthlyCare(client_id: string, year: number, month: number): Promise<void> {
      await d1
        .prepare("DELETE FROM client_monthly_care WHERE client_id = ? AND year = ? AND month = ?")
        .bind(client_id, year, month)
        .run();
    },

    async hasRecentMagicLinkSent(to_email: string, withinSeconds = 60): Promise<boolean> {
      const row = await d1
        .prepare(
          `SELECT id
           FROM email_logs
           WHERE to_email = ?
             AND source = 'api_send_magic_link'
             AND status = 'sent'
             AND created_at >= unixepoch() - ?
           ORDER BY created_at DESC
           LIMIT 1`
        )
        .bind(to_email.trim().toLowerCase(), withinSeconds)
        .first<{ id: string }>();
      return Boolean(row?.id);
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

    // ── Site care (P0: paired WordPress sites, read-only inventory) ──────────
    async createSitePairCode(p: { code_hash: string; client_id: string; created_by: string; expires_at: number }): Promise<void> {
      await d1
        .prepare("INSERT INTO site_pair_codes (code_hash, client_id, created_by, expires_at) VALUES (?, ?, ?, ?)")
        .bind(p.code_hash, p.client_id, p.created_by, p.expires_at)
        .run();
    },

    /** Atomically consumes an unexpired, unused code; returns its client_id or null. */
    async consumeSitePairCode(code_hash: string, now: number): Promise<string | null> {
      const row = await d1
        .prepare(
          `UPDATE site_pair_codes SET used_at = ?
           WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?
           RETURNING client_id`
        )
        .bind(now, code_hash, now)
        .first<{ client_id: string }>();
      return row?.client_id ?? null;
    },

    async createSite(p: {
      id: string; client_id: string; site_url: string; secret_enc: string; paired_at: number;
      plugin_version: string; wp_version: string;
    }): Promise<void> {
      await d1
        .prepare(
          `INSERT INTO sites (id, client_id, site_url, secret_enc, paired_at, plugin_version, wp_version)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(p.id, p.client_id, p.site_url, p.secret_enc, p.paired_at, p.plugin_version, p.wp_version)
        .run();
    },

    async getSiteById(id: string) {
      return d1.prepare("SELECT * FROM sites WHERE id = ?").bind(id).first<SiteRow>();
    },

    /** Clients with at least one paired, non-revoked site. */
    async listConnectedClientIds(): Promise<string[]> {
      const result = await d1
        .prepare("SELECT DISTINCT client_id FROM sites WHERE revoked_at IS NULL")
        .all<{ client_id: string }>();
      return result.results.map((r) => r.client_id);
    },

    async listSitesWithInventoryByClient(client_id: string) {
      const { results } = await d1
        .prepare(
          `SELECT s.*, i.json AS inventory_json, i.updated_at AS inventory_updated_at
           FROM sites s LEFT JOIN site_inventory i ON i.site_id = s.id
           WHERE s.client_id = ? ORDER BY s.revoked_at IS NOT NULL, s.paired_at DESC`
        )
        .bind(client_id)
        .all<SiteRow & { inventory_json: string | null; inventory_updated_at: number | null }>();
      return results;
    },

    async listAllSitesWithInventory() {
      const { results } = await d1
        .prepare(
          `SELECT s.*, i.json AS inventory_json, c.company_name AS client_company, c.kind AS client_kind, c.contract_end AS client_contract_end
           FROM sites s
           LEFT JOIN site_inventory i ON i.site_id = s.id
           JOIN clients c ON c.id = s.client_id
           WHERE s.revoked_at IS NULL AND c.deleted_at IS NULL
           ORDER BY s.last_seen_at IS NULL, s.site_url`
        )
        .all<SiteRow & { inventory_json: string | null; client_company: string; client_kind: "client" | "internal"; client_contract_end: string | null }>();
      return results;
    },

    async saveSiteHeartbeat(p: {
      site_id: string; now: number; json: string; site_url: string;
      plugin_version: string; wp_version: string; php_version: string;
    }): Promise<void> {
      await d1.batch([
        d1.prepare(
          `UPDATE sites SET last_seen_at = ?, site_url = ?, plugin_version = ?, wp_version = ?, php_version = ?
           WHERE id = ? AND revoked_at IS NULL`
        ).bind(p.now, p.site_url, p.plugin_version, p.wp_version, p.php_version, p.site_id),
        d1.prepare(
          `INSERT INTO site_inventory (site_id, json, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(site_id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`
        ).bind(p.site_id, p.json, p.now),
      ]);
    },

    async revokeSite(id: string, client_id: string, now: number): Promise<void> {
      await d1
        .prepare("UPDATE sites SET revoked_at = ? WHERE id = ? AND client_id = ? AND revoked_at IS NULL")
        .bind(now, id, client_id)
        .run();
    },

    // ── Site update jobs ─────────────────────────────────────────────────────

    async queueSiteJobs(jobs: Omit<SiteJobRow, "status" | "started_at" | "finished_at" | "result_version" | "log" | "reported_at">[]): Promise<number> {
      if (jobs.length === 0) return 0;
      const res = await d1.batch(
        jobs.map((j) =>
          d1.prepare(
            `INSERT INTO site_jobs (id, site_id, kind, slug, name, from_version, to_version, not_before, created_by, created_at)
             SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
             WHERE NOT EXISTS (SELECT 1 FROM site_jobs WHERE site_id = ? AND kind = ? AND slug = ? AND status IN ('queued','running'))`
          ).bind(j.id, j.site_id, j.kind, j.slug, j.name, j.from_version, j.to_version, j.not_before, j.created_by, j.created_at, j.site_id, j.kind, j.slug)
        )
      );
      return res.reduce((n, r) => n + (r.meta.changes ?? 0), 0);
    },

    /** Claims the next due job for a site, or null. Never more than one running per site. */
    async listDueSiteJobs(site_id: string, now: number): Promise<SiteJobRow[]> {
      const { results } = await d1
        .prepare("SELECT * FROM site_jobs WHERE site_id = ? AND status = 'queued' AND not_before <= ? ORDER BY created_at")
        .bind(site_id, now)
        .all<SiteJobRow>();
      return results;
    },

    /** Marks one queued job running, unless the site already has a running job. */
    async claimSiteJob(id: string, site_id: string, now: number): Promise<SiteJobRow | null> {
      try {
        return await d1
          .prepare(
            `UPDATE site_jobs SET status = 'running', started_at = ?
             WHERE id = ? AND site_id = ? AND status = 'queued'
               AND NOT EXISTS (SELECT 1 FROM site_jobs WHERE site_id = ? AND status = 'running')
             RETURNING *`
          )
          .bind(now, id, site_id, site_id)
          .first<SiteJobRow>();
      } catch {
        return null; // lost a race against the one-running index
      }
    },

    /** Queue stops after the site broke: nothing else may touch it until a person looks. */
    async cancelQueuedSiteJobsForSite(site_id: string, reason: string): Promise<number> {
      const r = await d1
        .prepare("UPDATE site_jobs SET status = 'cancelled', finished_at = unixepoch(), log = ? WHERE site_id = ? AND status = 'queued'")
        .bind(reason, site_id)
        .run();
      return r.meta.changes ?? 0;
    },

    async finishSiteJob(p: { id: string; site_id: string; status: SiteJobStatus; result_version: string | null; log: string; now: number }): Promise<boolean> {
      const r = await d1
        .prepare(
          `UPDATE site_jobs SET status = ?, result_version = ?, log = ?, finished_at = ?
           WHERE id = ? AND site_id = ? AND status IN ('running', 'queued')`
        )
        .bind(p.status, p.result_version, p.log, p.now, p.id, p.site_id)
        .run();
      return (r.meta.changes ?? 0) > 0;
    },

    async cancelSiteJob(id: string): Promise<void> {
      await d1.prepare("UPDATE site_jobs SET status = 'cancelled', finished_at = unixepoch() WHERE id = ? AND status = 'queued'").bind(id).run();
    },

    async cancelAllQueuedSiteJobs(): Promise<number> {
      const r = await d1.prepare("UPDATE site_jobs SET status = 'cancelled', finished_at = unixepoch() WHERE status = 'queued'").run();
      return r.meta.changes ?? 0;
    },

    /** Running jobs the site never reported back on (crash, timeout) are failed after `olderThan`. */
    async failStaleSiteJobs(olderThan: number): Promise<number> {
      const r = await d1
        .prepare(
          `UPDATE site_jobs SET status = 'failed', finished_at = unixepoch(),
             log = COALESCE(log, '') || 'ไม่ได้รับผลจากเว็บไซต์ภายในเวลาที่กำหนด — ตรวจสอบเว็บด้วยตนเอง'
           WHERE status = 'running' AND started_at < ?`
        )
        .bind(olderThan)
        .run();
      return r.meta.changes ?? 0;
    },

    /** Queued jobs the site never picked up (offline, unpaired) expire. */
    async expireUnclaimedSiteJobs(olderThan: number): Promise<number> {
      const r = await d1
        .prepare(
          `UPDATE site_jobs SET status = 'cancelled', finished_at = unixepoch(),
             log = 'เว็บไซต์ไม่ได้รับงานภายใน 24 ชม. — ยกเลิกอัตโนมัติ'
           WHERE status = 'queued' AND MAX(not_before, created_at) < ?`
        )
        .bind(olderThan)
        .run();
      return r.meta.changes ?? 0;
    },

    async listSiteJobs(opts: { site_ids?: string[]; since?: number; limit?: number }) {
      const where: string[] = [];
      const binds: unknown[] = [];
      if (opts.site_ids) {
        if (opts.site_ids.length === 0) return [];
        where.push(`j.site_id IN (${opts.site_ids.map(() => "?").join(",")})`);
        binds.push(...opts.site_ids);
      }
      if (opts.since) { where.push("j.created_at >= ?"); binds.push(opts.since); }
      const { results } = await d1
        .prepare(
          // No log column: lists are polled while updates run, logs load on demand.
          `SELECT j.id, j.site_id, j.kind, j.slug, j.name, j.from_version, j.to_version, j.status, j.not_before,
                  j.created_by, j.created_at, j.started_at, j.finished_at, j.result_version, j.reported_at,
                  j.log IS NOT NULL AND j.log != '' AS has_log, s.site_url, u.name AS created_by_name FROM site_jobs j
           JOIN sites s ON s.id = j.site_id LEFT JOIN users u ON u.id = j.created_by
           ${where.length ? "WHERE " + where.join(" AND ") : ""}
           ORDER BY j.created_at DESC LIMIT ?`
        )
        .bind(...binds, opts.limit ?? 100)
        .all<Omit<SiteJobRow, "log"> & { has_log: number; site_url: string; created_by_name: string | null }>();
      return results;
    },

    async countSiteJobsSince(site_id: string, since: number): Promise<number> {
      const r = await d1
        .prepare("SELECT COUNT(*) AS n FROM site_jobs WHERE site_id = ? AND status = 'succeeded' AND finished_at >= ?")
        .bind(site_id, since)
        .first<{ n: number }>();
      return r?.n ?? 0;
    },

    /** Succeeded jobs of a client's sites in [from, to) not yet copied into a report. */
    async listUnreportedSiteJobs(client_id: string, from: number, to: number) {
      const { results } = await d1
        .prepare(
          `SELECT j.*, s.site_url FROM site_jobs j JOIN sites s ON s.id = j.site_id
           WHERE s.client_id = ? AND j.status = 'succeeded' AND j.reported_at IS NULL
             -- "Already up to date" runs also finish as succeeded; only real version changes go in a report.
             AND j.result_version IS NOT NULL AND j.result_version IS NOT j.from_version
             -- Our own agent plugin is housekeeping, not work done for the client.
             AND j.slug != 'doaction-care/doaction-care.php'
             AND j.finished_at >= ? AND j.finished_at < ?
           ORDER BY j.finished_at`
        )
        .bind(client_id, from, to)
        .all<SiteJobRow & { site_url: string }>();
      return results;
    },

    async markSiteJobsReported(ids: string[], now: number): Promise<void> {
      if (ids.length === 0) return;
      await d1
        .prepare(`UPDATE site_jobs SET reported_at = ? WHERE id IN (${ids.map(() => "?").join(",")})`)
        .bind(now, ...ids)
        .run();
    },
  };
}

export type SiteRow = {
  id: string; client_id: string; site_url: string; secret_enc: string;
  paired_at: number; last_seen_at: number | null; revoked_at: number | null;
  plugin_version: string | null; wp_version: string | null; php_version: string | null;
};

export type DB = ReturnType<typeof createDB>;

export type SiteJobKind = "plugin" | "theme" | "core";
export type SiteJobStatus = "queued" | "running" | "succeeded" | "rolled_back" | "failed" | "cancelled";
export type SiteJobRow = {
  id: string; site_id: string; kind: SiteJobKind; slug: string; name: string;
  from_version: string | null; to_version: string | null; status: SiteJobStatus;
  not_before: number; created_by: string; created_at: number;
  started_at: number | null; finished_at: number | null;
  result_version: string | null; log: string | null; reported_at: number | null;
};
