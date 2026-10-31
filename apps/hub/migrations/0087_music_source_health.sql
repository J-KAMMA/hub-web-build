ALTER TABLE music_service_links ADD COLUMN availability_status TEXT NOT NULL DEFAULT 'unknown'
  CHECK (availability_status IN ('unknown','available','unavailable'));
ALTER TABLE music_service_links ADD COLUMN availability_checked_at TEXT;
CREATE INDEX IF NOT EXISTS idx_music_service_links_availability ON music_service_links(availability_status, availability_checked_at);
