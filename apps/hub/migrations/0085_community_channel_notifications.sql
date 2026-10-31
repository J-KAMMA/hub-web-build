PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS community_channel_notification_preferences (
  channel_id TEXT NOT NULL REFERENCES community_channels(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'mentions' CHECK(mode IN ('all','mentions','none')),
  muted_until TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(channel_id, profile_id)
);

CREATE INDEX IF NOT EXISTS idx_community_channel_notification_profile
  ON community_channel_notification_preferences(profile_id, updated_at DESC);
