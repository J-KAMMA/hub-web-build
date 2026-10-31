-- Add provider 'hub' (a Hub self-made video) to external_videos (docs/hub-video/PLAN.md 4.2, 7.2).
--
-- SQLite cannot change a CHECK in place, so the table is rebuilt the way 0027 and 0112 did it, but
-- with the new table built under a temporary name, filled, and only then swapped in for the old
-- one: child tables keep referencing the name external_videos, and no rename touches them (0126
-- had to repair the children that the 0027/0112 order broke). Every column, index and constraint
-- is unchanged except provider IN (..., 'hub').
--
-- REHEARSE on a copy of production before applying: DROP TABLE on a parent runs an implicit
-- DELETE, and the ON DELETE CASCADE children (saves, playlist items, views, likes, comments,
-- playback events, activity, reports) must still have their row counts afterwards.
PRAGMA foreign_keys = OFF;
PRAGMA defer_foreign_keys = ON;

CREATE TABLE external_videos_hub_provider_new (
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
  submitter_visible INTEGER NOT NULL DEFAULT 1,
  ingest_source TEXT NOT NULL DEFAULT 'manual',
  youtube_metadata_refreshed_at TEXT,
  safety_level TEXT NOT NULL DEFAULT 'standard',
  safety_notice TEXT,
  availability_status TEXT NOT NULL DEFAULT 'unknown',
  availability_failures INTEGER NOT NULL DEFAULT 0,
  availability_checked_at TEXT,
  broadcast_status TEXT NOT NULL DEFAULT 'video',
  metadata_checked_at TEXT,
  CHECK (provider IN ('youtube', 'vimeo', 'twitch', 'niconico', 'tiktok', 'dailymotion', 'peertube', 'hub')),
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
  CHECK (submitter_visible IN (0, 1)),
  CHECK (ingest_source IN ('manual', 'social_post', 'thread', 'thread_reply')),
  CHECK (safety_level IN ('standard','sensitive','adult','medical','political')),
  CHECK (availability_status IN ('unknown','available','unavailable')),
  CHECK (broadcast_status IN ('video', 'live', 'upcoming', 'archive')),
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

INSERT INTO external_videos_hub_provider_new (
  id, provider, external_video_id, source_url, title, channel, category,
  thumbnail_url, duration, published_at, submitted_by_profile_id, status,
  created_at, updated_at, purpose, topic, related_hubpedia_slug,
  submitter_visible, ingest_source, youtube_metadata_refreshed_at,
  safety_level, safety_notice, availability_status, availability_failures,
  availability_checked_at, broadcast_status, metadata_checked_at
)
SELECT
  id, provider, external_video_id, source_url, title, channel, category,
  thumbnail_url, duration, published_at, submitted_by_profile_id, status,
  created_at, updated_at, purpose, topic, related_hubpedia_slug,
  submitter_visible, ingest_source, youtube_metadata_refreshed_at,
  safety_level, safety_notice, availability_status, availability_failures,
  availability_checked_at, broadcast_status, metadata_checked_at
FROM external_videos;

DROP TABLE external_videos;
ALTER TABLE external_videos_hub_provider_new RENAME TO external_videos;

CREATE INDEX idx_external_videos_public ON external_videos(status, published_at DESC, created_at DESC);
CREATE INDEX idx_external_videos_submitter ON external_videos(submitted_by_profile_id, created_at DESC);
CREATE INDEX idx_external_videos_discovery ON external_videos(status, purpose, topic, published_at DESC);
CREATE INDEX idx_external_videos_hubpedia ON external_videos(related_hubpedia_slug, status, published_at DESC)
  WHERE related_hubpedia_slug IS NOT NULL;
CREATE INDEX idx_external_videos_youtube_refresh ON external_videos(provider, status, youtube_metadata_refreshed_at);
CREATE INDEX external_videos_availability_due ON external_videos(status, availability_checked_at);

PRAGMA defer_foreign_keys = OFF;
PRAGMA foreign_keys = ON;
