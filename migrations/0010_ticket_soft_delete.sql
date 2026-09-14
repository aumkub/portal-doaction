-- Soft-delete for support tickets
ALTER TABLE support_tickets ADD COLUMN deleted_at INTEGER;
ALTER TABLE support_tickets ADD COLUMN deleted_by TEXT REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_tickets_deleted_at ON support_tickets(deleted_at);
