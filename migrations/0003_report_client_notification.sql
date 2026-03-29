-- Track when admin emailed the client about a published report (for status + view copy)
ALTER TABLE monthly_reports ADD COLUMN client_notified_at INTEGER;
ALTER TABLE monthly_reports ADD COLUMN client_notification_subject TEXT;
ALTER TABLE monthly_reports ADD COLUMN client_notification_html TEXT;
