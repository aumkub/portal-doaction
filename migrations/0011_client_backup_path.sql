-- WebDAV backup folder name under /home/Backup (e.g. gooddrive-golf), set by admin only
ALTER TABLE clients ADD COLUMN backup_path TEXT;
