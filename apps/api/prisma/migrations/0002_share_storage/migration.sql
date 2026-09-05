ALTER TABLE shares ADD COLUMN package_type TEXT NOT NULL DEFAULT 'exam';
ALTER TABLE shares ADD COLUMN storage_key TEXT;
UPDATE shares SET storage_key = CASE WHEN package_type = 'vocabularySet' THEN 'shared-exams/' || code || '.json' ELSE 'shared-exams/' || code || '.exam' END WHERE storage_key IS NULL;
