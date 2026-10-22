-- One-click sign-in from a client's wp-admin (do action Care widget).
ALTER TABLE clients ADD COLUMN sso_enabled INTEGER NOT NULL DEFAULT 1;

-- Audit trail: every request, granted or refused.
CREATE TABLE IF NOT EXISTS sso_logins (
  id         TEXT PRIMARY KEY,
  client_id  TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  site_id    TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  wp_email   TEXT NOT NULL,
  outcome    TEXT NOT NULL CHECK(outcome IN ('issued', 'used', 'email_mismatch', 'disabled', 'not_client', 'rate_limited')),
  ip         TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sso_logins_client ON sso_logins(client_id, created_at);
