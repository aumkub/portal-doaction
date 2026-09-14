-- Add Telegram group ID to co_admin_clients for routing notifications
ALTER TABLE co_admin_clients ADD COLUMN telegram_group_id TEXT;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_co_admin_clients_group ON co_admin_clients(co_admin_id, client_id);
