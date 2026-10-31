PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS community_message_polls (
  message_id TEXT PRIMARY KEY REFERENCES community_channel_messages(id) ON DELETE CASCADE,
  closes_at TEXT,
  multiple_choice INTEGER NOT NULL DEFAULT 0 CHECK(multiple_choice IN (0,1)),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS community_message_poll_options (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES community_message_polls(message_id) ON DELETE CASCADE,
  label TEXT NOT NULL CHECK(length(label) BETWEEN 1 AND 100),
  position INTEGER NOT NULL,
  UNIQUE(message_id, position)
);

CREATE TABLE IF NOT EXISTS community_message_poll_votes (
  option_id TEXT NOT NULL REFERENCES community_message_poll_options(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY(option_id, profile_id)
);

CREATE TABLE IF NOT EXISTS community_scheduled_messages (
  id TEXT PRIMARY KEY,
  community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL REFERENCES community_channels(id) ON DELETE CASCADE,
  author_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 2000),
  kind TEXT NOT NULL DEFAULT 'chat' CHECK(kind IN ('chat','guide','question','party')),
  scheduled_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','published','cancelled','failed')),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_community_scheduled_due ON community_scheduled_messages(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_community_poll_options_message ON community_message_poll_options(message_id, position);
