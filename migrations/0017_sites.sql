-- Remote site care (P0, read-only): WordPress sites paired via the doaction-care plugin.
CREATE TABLE IF NOT EXISTS sites (
  id             TEXT PRIMARY KEY,
  client_id      TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  site_url       TEXT NOT NULL,
  secret_enc     TEXT NOT NULL,          -- AES-GCM(iv||ct) base64, key derived from SESSION_SECRET
  paired_at      INTEGER NOT NULL,
  last_seen_at   INTEGER,
  revoked_at     INTEGER,
  plugin_version TEXT,
  wp_version     TEXT,
  php_version    TEXT
);
CREATE INDEX IF NOT EXISTS idx_sites_client ON sites(client_id);

CREATE TABLE IF NOT EXISTS site_inventory (
  site_id    TEXT PRIMARY KEY REFERENCES sites(id) ON DELETE CASCADE,
  json       TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS site_pair_codes (
  code_hash  TEXT PRIMARY KEY,           -- sha256 hex of the code
  client_id  TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at    INTEGER
);
