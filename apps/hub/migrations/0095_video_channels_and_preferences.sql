CREATE TABLE IF NOT EXISTS video_channels (
  channel_key TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  provider TEXT NOT NULL,
  source_url TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'hidden', 'review')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO video_channels (channel_key, display_name, provider, source_url, created_at, updated_at)
SELECT lower(trim(channel)) || ':' || provider, channel, provider, NULL, min(created_at), max(updated_at)
FROM external_videos GROUP BY lower(trim(channel)), provider;

CREATE TABLE IF NOT EXISTS video_channel_follows (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  channel_key TEXT NOT NULL REFERENCES video_channels(channel_key) ON DELETE CASCADE,
  notifications_enabled INTEGER NOT NULL DEFAULT 0 CHECK (notifications_enabled IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (profile_id, channel_key)
);

CREATE TABLE IF NOT EXISTS video_recommendation_settings (
  profile_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  topics_json TEXT NOT NULL DEFAULT '{}',
  channels_json TEXT NOT NULL DEFAULT '{}',
  videos_json TEXT NOT NULL DEFAULT '{}',
  categories_json TEXT NOT NULL DEFAULT '{}',
  analytics_enabled INTEGER NOT NULL DEFAULT 1 CHECK (analytics_enabled IN (0, 1)),
  updated_at TEXT NOT NULL
);

ALTER TABLE external_videos ADD COLUMN broadcast_status TEXT NOT NULL DEFAULT 'video' CHECK (broadcast_status IN ('video', 'live', 'upcoming', 'archive'));
ALTER TABLE external_videos ADD COLUMN metadata_checked_at TEXT;

CREATE INDEX IF NOT EXISTS video_channels_provider_name ON video_channels(provider, display_name);
CREATE INDEX IF NOT EXISTS video_channel_follows_profile ON video_channel_follows(profile_id, updated_at DESC);
