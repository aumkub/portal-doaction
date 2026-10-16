-- A ticket message can quote an earlier message in the same ticket.
ALTER TABLE ticket_messages ADD COLUMN reply_to_id TEXT;
