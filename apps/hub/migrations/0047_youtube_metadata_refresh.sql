ALTER TABLE external_videos ADD COLUMN youtube_metadata_refreshed_at TEXT;

UPDATE external_videos
SET youtube_metadata_refreshed_at = updated_at
WHERE provider = 'youtube' AND youtube_metadata_refreshed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_external_videos_youtube_refresh
  ON external_videos(provider, status, youtube_metadata_refreshed_at);
