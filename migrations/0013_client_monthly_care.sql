-- Admin-only monthly "looked after" mark per client. Keyed by month, so a
-- new month starts with every client unmarked; old months stay as history.
CREATE TABLE IF NOT EXISTS client_monthly_care (
  client_id  TEXT    NOT NULL,
  year       INTEGER NOT NULL,
  month      INTEGER NOT NULL,
  checked_by TEXT    NOT NULL,
  checked_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (client_id, year, month)
);
