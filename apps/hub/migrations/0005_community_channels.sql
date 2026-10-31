PRAGMA foreign_keys = ON;

-- Community channels are independent from BBS threads. They belong only to
-- a Hub-local pseudonymous community and use Hub-local profile authors.
CREATE TABLE IF NOT EXISTS community_channels (
  id TEXT PRIMARY KEY,
  community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  name TEXT NOT NULL COLLATE NOCASE,
  description TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE (community_id, name),
  CHECK (length(name) BETWEEN 1 AND 50),
  CHECK (length(description) <= 200),
  CHECK (position >= 0)
);
CREATE INDEX IF NOT EXISTS idx_community_channels_order
  ON community_channels(community_id, position, created_at);

CREATE TABLE IF NOT EXISTS community_channel_messages (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES community_channels(id) ON DELETE CASCADE,
  author_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK (length(body) BETWEEN 1 AND 2000)
);
CREATE INDEX IF NOT EXISTS idx_community_channel_messages_timeline
  ON community_channel_messages(channel_id, created_at, id);
