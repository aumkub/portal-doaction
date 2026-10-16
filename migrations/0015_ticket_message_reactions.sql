-- One row per (message, user, reaction); toggling deletes the row.
CREATE TABLE IF NOT EXISTS ticket_message_reactions (
  message_id TEXT NOT NULL REFERENCES ticket_messages(id) ON DELETE CASCADE,
  ticket_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  reaction TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (message_id, user_id, reaction)
);
CREATE INDEX IF NOT EXISTS idx_reactions_ticket ON ticket_message_reactions(ticket_id);
