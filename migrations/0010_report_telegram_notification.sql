-- Track when Telegram notification was sent for a published report
ALTER TABLE monthly_reports ADD COLUMN telegram_notified_at INTEGER;
