ALTER TABLE external_videos ADD COLUMN safety_level TEXT NOT NULL DEFAULT 'standard' CHECK (safety_level IN ('standard','sensitive','adult','medical','political'));
ALTER TABLE external_videos ADD COLUMN safety_notice TEXT;
ALTER TABLE external_videos ADD COLUMN availability_status TEXT NOT NULL DEFAULT 'unknown' CHECK (availability_status IN ('unknown','available','unavailable'));
ALTER TABLE external_videos ADD COLUMN availability_failures INTEGER NOT NULL DEFAULT 0;
ALTER TABLE external_videos ADD COLUMN availability_checked_at TEXT;
CREATE INDEX IF NOT EXISTS external_videos_availability_due ON external_videos(status, availability_checked_at);
