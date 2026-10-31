-- D1 always enforces foreign keys. Deferring them and keeping legacy ALTER
-- behavior lets us replace the provider CHECK without redirecting playlist
-- and save references to the temporary table.
PRAGMA defer_foreign_keys = ON;
PRAGMA legacy_alter_table = ON;

ALTER TABLE external_videos RENAME TO external_videos_before_tiktok;

CREATE TABLE external_videos (
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
  purpose TEXT NOT NULL DEFAULT 'other',
  topic TEXT NOT NULL DEFAULT '未分類',
  related_hubpedia_slug TEXT,
  CHECK (provider IN ('youtube', 'vimeo', 'twitch', 'niconico', 'tiktok')),
  CHECK (length(external_video_id) BETWEEN 1 AND 128),
  CHECK (length(source_url) BETWEEN 1 AND 2048),
  CHECK (length(title) BETWEEN 1 AND 240),
  CHECK (length(channel) BETWEEN 1 AND 120),
  CHECK (length(category) BETWEEN 1 AND 80),
  CHECK (thumbnail_url IS NULL OR length(thumbnail_url) <= 2048),
  CHECK (duration IS NULL OR length(duration) <= 32),
  CHECK (status IN ('active', 'removed')),
  CHECK (purpose IN ('guide', 'explanation', 'live', 'review', 'creation', 'music', 'other')),
  CHECK (length(topic) BETWEEN 1 AND 80),
  CHECK (
    related_hubpedia_slug IS NULL OR (
      length(related_hubpedia_slug) BETWEEN 1 AND 160
      AND related_hubpedia_slug = lower(related_hubpedia_slug)
      AND related_hubpedia_slug NOT GLOB '*[^a-z0-9-]*'
      AND related_hubpedia_slug NOT LIKE '-%'
      AND related_hubpedia_slug NOT LIKE '%-'
      AND related_hubpedia_slug NOT LIKE '%--%'
    )
  ),
  UNIQUE (provider, external_video_id)
);

INSERT INTO external_videos (
  id, provider, external_video_id, source_url, title, channel, category,
  thumbnail_url, duration, published_at, submitted_by_profile_id, status,
  created_at, updated_at, purpose, topic, related_hubpedia_slug
)
SELECT
  id, provider, external_video_id, source_url, title, channel, category,
  thumbnail_url, duration, published_at, submitted_by_profile_id, status,
  created_at, updated_at, purpose, topic, related_hubpedia_slug
FROM external_videos_before_tiktok;

DROP TABLE external_videos_before_tiktok;

CREATE INDEX idx_external_videos_public
  ON external_videos(status, published_at DESC, created_at DESC);
CREATE INDEX idx_external_videos_submitter
  ON external_videos(submitted_by_profile_id, created_at DESC);
CREATE INDEX idx_external_videos_discovery
  ON external_videos(status, purpose, topic, published_at DESC);
CREATE INDEX idx_external_videos_hubpedia
  ON external_videos(related_hubpedia_slug, status, published_at DESC)
  WHERE related_hubpedia_slug IS NOT NULL;

PRAGMA legacy_alter_table = OFF;
PRAGMA defer_foreign_keys = OFF;
