-- Remote site care P2/P3: update jobs. Each row is one item (plugin, theme or core)
-- updated on one site; the table doubles as the audit log.
CREATE TABLE IF NOT EXISTS site_jobs (
  id           TEXT PRIMARY KEY,
  site_id      TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK(kind IN ('plugin', 'theme', 'core')),
  slug         TEXT NOT NULL,
  name         TEXT NOT NULL,
  from_version TEXT,
  to_version   TEXT,
  status       TEXT NOT NULL CHECK(status IN ('queued', 'running', 'succeeded', 'rolled_back', 'failed', 'cancelled')) DEFAULT 'queued',
  not_before   INTEGER NOT NULL DEFAULT 0, -- update window: the site may not start it earlier
  created_by   TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  started_at   INTEGER,
  finished_at  INTEGER,
  result_version TEXT,
  log          TEXT,
  reported_at  INTEGER                     -- copied into the monthly report
);
CREATE INDEX IF NOT EXISTS idx_site_jobs_site ON site_jobs(site_id, status);
CREATE INDEX IF NOT EXISTS idx_site_jobs_created ON site_jobs(created_at);
-- At most one running job per site.
CREATE UNIQUE INDEX IF NOT EXISTS idx_site_jobs_one_running ON site_jobs(site_id) WHERE status = 'running';
