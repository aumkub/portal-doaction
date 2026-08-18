-- Distinguish co-admin vs freelance on the team page.
-- Auth role stays `co-admin`; `team_type` is display/grouping only.
ALTER TABLE users ADD COLUMN team_type TEXT NOT NULL DEFAULT 'co-admin';
