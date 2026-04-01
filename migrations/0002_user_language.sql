ALTER TABLE users
ADD COLUMN language TEXT NOT NULL DEFAULT 'th' CHECK(language IN ('th', 'en'));
