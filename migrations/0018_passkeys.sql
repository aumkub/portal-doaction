-- Passkeys (WebAuthn) as an alternative staff second factor.
-- Each staff user picks ONE method: 'totp' (authenticator app) or 'passkey'.
-- Recovery codes (users.totp_recovery) apply to either method.
CREATE TABLE IF NOT EXISTS user_passkeys (
  id TEXT PRIMARY KEY,              -- credential ID, base64url
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key TEXT NOT NULL,         -- COSE public key, base64url
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT,                  -- JSON array of AuthenticatorTransport
  name TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  last_used_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_user_passkeys_user_id ON user_passkeys(user_id);

ALTER TABLE users ADD COLUMN two_factor_method TEXT;
UPDATE users SET two_factor_method = 'totp' WHERE totp_enabled_at IS NOT NULL;
