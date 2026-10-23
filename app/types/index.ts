// ─── User & Auth ─────────────────────────────────────────────────────────────

export type UserRole = "admin" | "client" | "co-admin";

export type TeamType = "co-admin" | "freelance";

export type UserLanguage = "th" | "en";

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  team_type?: TeamType | null;
  password_hash: string | null;
  avatar_url: string | null;
  language?: UserLanguage | null;
  first_login_at?: number | null;
  totp_secret?: string | null;
  totp_enabled_at?: number | null;
  totp_recovery?: string | null;
  two_factor_method?: TwoFactorMethod | null;
  /** Session attribute: true when the user has any second factor set up. */
  two_factor_enabled?: boolean;
  created_at: number;
  updated_at: number;
}

export interface Session {
  id: string;
  user_id: string;
  expires_at: number;
}

export interface MagicLinkToken {
  id: string;
  user_id: string;
  token: string;
  expires_at: number;
  used: number;
}

// ─── Client ──────────────────────────────────────────────────────────────────

export type ClientPackage = "basic" | "standard" | "premium";

export type ClientKind = "client" | "internal";

export interface Client {
  id: string;
  user_id: string;
  company_name: string;
  website_url: string | null;
  cc_emails: string | null;
  package: ClientPackage;
  contract_start: string | null;
  contract_end: string | null;
  notes: string | null;
  /** "internal" = our own / sister website: admin-only, no client login, emails or reports. */
  kind: ClientKind;
  /** 1 = the client may sign in from their wp-admin with one click (email must match). */
  sso_enabled: number;
  /** 1 = an admin suspended new tickets from this client. */
  ticket_block: number;
  deleted_at?: number | null;
  created_at: number;
}

// ─── Monthly Report ──────────────────────────────────────────────────────────

export type ReportStatus = "draft" | "published";
export type TaskCategory =
  | "maintenance"
  | "development"
  | "security"
  | "seo"
  | "performance"
  | "other";

export interface MonthlyReport {
  id: string;
  client_id: string;
  year: number;
  month: number;
  title: string;
  summary: string | null;
  uptime_percent: number | null;
  speed_score: number | null;
  total_tasks: number;
  status: ReportStatus;
  published_at: number | null;
  created_at: number;
  /** When admin emailed the client about this published report */
  client_notified_at?: number | null;
  client_notification_subject?: string | null;
  client_notification_html?: string | null;
  /** When Telegram notification was last sent for this report */
  telegram_notified_at?: number | null;
}

export interface ReportTask {
  id: string;
  report_id: string;
  category: TaskCategory;
  title: string;
  description: string | null;
  completed: number;
  sort_order: number;
}

export type ReportWithTasks = MonthlyReport & { tasks: ReportTask[] };

// ─── Support Ticket ───────────────────────────────────────────────────────────

export type TicketPriority = "low" | "medium" | "high" | "urgent";
export type TicketStatus =
  | "open"
  | "in_progress"
  | "waiting"
  | "resolved"
  | "closed";

export interface SupportTicket {
  id: string;
  client_id: string;
  title: string;
  description: string;
  priority: TicketPriority;
  status: TicketStatus;
  created_by: string;
  assigned_to: string | null;
  resolved_at: number | null;
  created_at: number;
  updated_at: number;
  deleted_at?: number | null;
  deleted_by?: string | null;
}

/** The slice of a user that is safe to send to the browser alongside messages. */
export type MessageAuthor = Pick<User, "id" | "name" | "role" | "avatar_url">;

export interface TicketMessage {
  id: string;
  ticket_id: string;
  user_id: string;
  message: string;
  is_internal: number;
  /** Earlier message in the same ticket this one replies to. */
  reply_to_id?: string | null;
  created_at: number;
}

export interface TicketAttachment {
  id: string;
  ticket_id: string;
  message_id: string;
  uploader_user_id: string;
  file_key: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  created_at: number;
}

export type TicketWithMessages = SupportTicket & { messages: TicketMessage[] };

// ─── Notification ────────────────────────────────────────────────────────────

export interface Notification {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read: number;
  created_at: number;
}

// ─── Co-Admin ─────────────────────────────────────────────────────────────────

export interface CoAdminClient {
  id: string;
  co_admin_id: string;
  client_id: string;
  created_at: number;
}

export interface CustomerNote {
  id: string;
  client_id: string;
  user_id: string;
  note: string;
  created_at: number;
  updated_at: number;
}

export interface CustomerNoteWithUser extends CustomerNote {
  user_name: string;
  user_role: UserRole;
}

// ─── Email Log ───────────────────────────────────────────────────────────────

export interface EmailLog {
  id: string;
  to_email: string;
  to_name: string | null;
  cc_emails: string | null;
  subject: string;
  html_body: string;
  text_body: string;
  source: string | null;
  status: "sent" | "failed";
  error_message: string | null;
  created_at: number;
}

// ─── Cloudflare Env ───────────────────────────────────────────────────────────

// Canonical env type — also declared globally in app/types/cloudflare.d.ts
export type { } // keep module

export type TwoFactorMethod = "totp" | "passkey";

export interface UserPasskey {
  id: string;
  user_id: string;
  public_key: string;
  counter: number;
  transports: string | null;
  name: string | null;
  created_at: number;
  last_used_at: number | null;
}
