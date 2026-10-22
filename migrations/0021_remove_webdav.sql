-- Backups are now reported by the do action Care plugin (All-in-One WP
-- Migration / UpdraftPlus); the WebDAV backup server is no longer read.
DELETE FROM app_settings WHERE key LIKE 'webdav\_%' ESCAPE '\';
ALTER TABLE clients DROP COLUMN backup_path;
