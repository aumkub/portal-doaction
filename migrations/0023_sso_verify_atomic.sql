-- SSO hardening: tokens and agent nonces in D1 so single use is atomic, and
-- a one-time email confirmation per (site, email) before one-click sign-in.
CREATE TABLE IF NOT EXISTS sso_tokens (
  hash       TEXT PRIMARY KEY,           -- sha256 of the token
  kind       TEXT NOT NULL CHECK(kind IN ('login', 'verify')),
  data       TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sso_verified (
  site_id     TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  verified_at INTEGER NOT NULL,
  PRIMARY KEY (site_id, email)
);

CREATE TABLE IF NOT EXISTS agent_nonces (
  nonce_key  TEXT PRIMARY KEY,           -- site_id:nonce
  expires_at INTEGER NOT NULL
);

-- Widen the audit outcomes (SQLite cannot alter a CHECK in place).
CREATE TABLE sso_logins_new (
  id         TEXT PRIMARY KEY,
  client_id  TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  site_id    TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  wp_email   TEXT NOT NULL,
  outcome    TEXT NOT NULL CHECK(outcome IN ('issued', 'used', 'email_mismatch', 'disabled', 'not_client', 'rate_limited', 'verify_sent', 'verified')),
  ip         TEXT,
  created_at INTEGER NOT NULL
);
INSERT INTO sso_logins_new SELECT * FROM sso_logins;
DROP TABLE sso_logins;
ALTER TABLE sso_logins_new RENAME TO sso_logins;
CREATE INDEX IF NOT EXISTS idx_sso_logins_client ON sso_logins(client_id, created_at);
