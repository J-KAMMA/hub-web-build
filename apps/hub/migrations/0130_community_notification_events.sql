PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS community_notification_events (
  notification_id TEXT PRIMARY KEY REFERENCES notifications(id) ON DELETE CASCADE,
  community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL REFERENCES community_channels(id) ON DELETE CASCADE,
  event_kind TEXT NOT NULL CHECK (event_kind IN ('mention', 'reply')),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_community_notification_events_scope
  ON community_notification_events(community_id, channel_id, created_at DESC);
