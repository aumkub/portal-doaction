-- Users (ใช้ร่วมกัน admin และ client)
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin', 'client')),
  avatar_url TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Sessions (Lucia Auth)
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

-- Magic Link Tokens
CREATE TABLE magic_link_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);

-- Clients (ข้อมูลลูกค้า)
CREATE TABLE clients (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_name TEXT NOT NULL,
  website_url TEXT,
  package TEXT NOT NULL CHECK(package IN ('basic', 'standard', 'premium')),
  contract_start DATE,
  contract_end DATE,
  notes TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Monthly Reports
CREATE TABLE monthly_reports (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL CHECK(month BETWEEN 1 AND 12),
  title TEXT NOT NULL,
  summary TEXT,
  uptime_percent REAL,
  speed_score INTEGER,
  total_tasks INTEGER DEFAULT 0,
  status TEXT NOT NULL CHECK(status IN ('draft', 'published')) DEFAULT 'draft',
  published_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(client_id, year, month)
);

-- Report Tasks (รายละเอียดงานในแต่ละ report)
CREATE TABLE report_tasks (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES monthly_reports(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK(category IN ('maintenance', 'development', 'security', 'seo', 'performance', 'other')),
  title TEXT NOT NULL,
  description TEXT,
  completed INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER DEFAULT 0
);

-- Support Tickets
CREATE TABLE support_tickets (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  priority TEXT NOT NULL CHECK(priority IN ('low', 'medium', 'high', 'urgent')) DEFAULT 'medium',
  status TEXT NOT NULL CHECK(status IN ('open', 'in_progress', 'waiting', 'resolved', 'closed')) DEFAULT 'open',
  created_by TEXT NOT NULL REFERENCES users(id),
  assigned_to TEXT REFERENCES users(id),
  resolved_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Ticket Messages (thread)
CREATE TABLE ticket_messages (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  message TEXT NOT NULL,
  is_internal INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Notifications
CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  read INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Indexes
CREATE INDEX idx_clients_user_id ON clients(user_id);
CREATE INDEX idx_reports_client_id ON monthly_reports(client_id);
CREATE INDEX idx_tickets_client_id ON support_tickets(client_id);
CREATE INDEX idx_ticket_messages_ticket_id ON ticket_messages(ticket_id);
CREATE INDEX idx_notifications_user_id ON notifications(user_id, read);
