// ─── User & Auth ─────────────────────────────────────────────────────────────

export type UserRole = "admin" | "client" | "co-admin";

export type UserLanguage = "th" | "en";

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  password_hash: string | null;
  avatar_url: string | null;
  language?: UserLanguage | null;
  first_login_at?: number | null;
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
  deleted_at: number | null;
  deleted_by: string | null;
}

export interface TicketMessage {
  id: string;
  ticket_id: string;
  user_id: string;
  message: string;
  is_internal: number;
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
