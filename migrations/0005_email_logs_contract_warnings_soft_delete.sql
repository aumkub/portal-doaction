-- Email delivery logs
CREATE TABLE IF NOT EXISTS email_logs (
  id TEXT PRIMARY KEY,
  to_email TEXT NOT NULL,
  to_name TEXT,
  subject TEXT NOT NULL,
  html_body TEXT NOT NULL,
  text_body TEXT NOT NULL,
  source TEXT,
  status TEXT NOT NULL CHECK(status IN ('sent', 'failed')) DEFAULT 'sent',
  error_message TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_email_logs_created_at ON email_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_logs_to_email ON email_logs(to_email);

-- Track contract warning sends to prevent duplicate notifications
CREATE TABLE IF NOT EXISTS contract_warning_logs (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  warning_stage TEXT NOT NULL CHECK(warning_stage IN ('first', 'second', 'third')),
  contract_end TEXT NOT NULL,
  sent_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(client_id, warning_stage, contract_end)
);

CREATE INDEX IF NOT EXISTS idx_contract_warning_logs_client ON contract_warning_logs(client_id);

-- Soft-delete for clients
ALTER TABLE clients ADD COLUMN deleted_at INTEGER;
CREATE INDEX IF NOT EXISTS idx_clients_deleted_at ON clients(deleted_at);
