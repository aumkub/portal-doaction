-- Add co-admin support
-- 1. Update users table to support co-admin role and password authentication
-- 
-- ⚠️ When recreating a table and dropping the old one, you lose only the data in that table,
--    but not in other tables unless they have ON DELETE CASCADE and are referencing this table with foreign keys.
--    In this migration, the 'users' table is recreated, but data from 'users' is preserved by copying it to the new table.
--    All related tables (e.g., clients, support_tickets) are unaffected unless ON DELETE CASCADE is set to users(id)
--    and SQLite's foreign keys are ENABLED. This script assumes you want to preserve all users' data.

-- Add password_hash column (if not already exists)
ALTER TABLE users ADD COLUMN password_hash TEXT;

-- To update the 'role' constraint, recreate the users table with the additional role,
-- copy data, and perform a safe table switch.
CREATE TABLE users_new (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin', 'client', 'co-admin')),
  password_hash TEXT,
  avatar_url TEXT,
  language TEXT,
  first_login_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Copy all data from old users table to new, preserving all rows.
INSERT INTO users_new (id, email, name, role, avatar_url, language, first_login_at, created_at, updated_at, password_hash)
SELECT id, email, name, role, avatar_url, language, first_login_at, created_at, updated_at, password_hash FROM users;

-- Only now drop the old users table & rename the new one.
-- This preserves all user data (including new password_hash values if any are set).
DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

-- Recreate indexes for other tables as before (unaffected by users table switch)
CREATE INDEX IF NOT EXISTS idx_clients_user_id ON clients(user_id);
CREATE INDEX IF NOT EXISTS idx_tickets_client_id ON support_tickets(client_id);
CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticket_id ON ticket_messages(ticket_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id, read);

-- 2. Co-Admin to Client assignment table (many-to-many)
CREATE TABLE co_admin_clients (
  id TEXT PRIMARY KEY,
  co_admin_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(co_admin_id, client_id)
);

CREATE INDEX idx_co_admin_clients_co_admin ON co_admin_clients(co_admin_id);
CREATE INDEX idx_co_admin_clients_client ON co_admin_clients(client_id);

-- 3. Customer internal notes table
CREATE TABLE customer_notes (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  note TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_customer_notes_client ON customer_notes(client_id);
CREATE INDEX idx_customer_notes_created ON customer_notes(created_at DESC);
