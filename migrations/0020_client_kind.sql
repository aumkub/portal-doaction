-- Sister/in-house websites live in `clients` too, so they share sites,
-- remote updates, backups and uptime. kind = 'internal' means: no client
-- login or email, no package/contract, no monthly report, not counted.
ALTER TABLE clients ADD COLUMN kind TEXT NOT NULL DEFAULT 'client' CHECK(kind IN ('client', 'internal'));
UPDATE clients SET kind = 'internal' WHERE company_name = 'บริษัท ดู แอคชั่น จำกัด';
