-- Telegram as an extra way to approve a login (staff 2FA). The chat id is the
-- user's own private chat with the portal bot, confirmed with a one-time code.
ALTER TABLE users ADD COLUMN telegram_chat_id TEXT;
