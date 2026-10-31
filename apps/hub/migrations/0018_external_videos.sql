PRAGMA foreign_keys = ON;

-- Hub stores only the public catalog metadata supplied by a Hub profile.
-- Video bodies and provider account identifiers remain at the source provider.
CREATE TABLE IF NOT EXISTS external_videos (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  external_video_id TEXT NOT NULL,
  source_url TEXT NOT NULL,
  title TEXT NOT NULL,
  channel TEXT NOT NULL,
  category TEXT NOT NULL,
  thumbnail_url TEXT,
  duration TEXT,
  published_at TEXT NOT NULL,
  submitted_by_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (provider IN ('youtube', 'vimeo', 'twitch', 'niconico')),
  CHECK (length(external_video_id) BETWEEN 1 AND 128),
  CHECK (length(source_url) BETWEEN 1 AND 2048),
  CHECK (length(title) BETWEEN 1 AND 240),
  CHECK (length(channel) BETWEEN 1 AND 120),
  CHECK (length(category) BETWEEN 1 AND 80),
  CHECK (thumbnail_url IS NULL OR length(thumbnail_url) <= 2048),
  CHECK (duration IS NULL OR length(duration) <= 32),
  CHECK (status IN ('active', 'removed')),
  UNIQUE (provider, external_video_id)
);

CREATE INDEX IF NOT EXISTS idx_external_videos_public
  ON external_videos(status, published_at DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_external_videos_submitter
  ON external_videos(submitted_by_profile_id, created_at DESC);
