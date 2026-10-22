-- TOTP two-factor authentication for admin / co-admin users.
-- totp_secret: AES-GCM encrypted base32 secret (set once enrollment is confirmed)
-- totp_enabled_at: unix seconds when 2FA was turned on (NULL = off)
-- totp_recovery: JSON array of SHA-256 hex hashes of unused recovery codes
ALTER TABLE users ADD COLUMN totp_secret TEXT;
ALTER TABLE users ADD COLUMN totp_enabled_at INTEGER;
ALTER TABLE users ADD COLUMN totp_recovery TEXT;
