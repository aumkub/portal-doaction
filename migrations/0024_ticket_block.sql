-- Admin switch to stop a client from opening new tickets (spam / misuse).
ALTER TABLE clients ADD COLUMN ticket_block INTEGER NOT NULL DEFAULT 0;
