PRAGMA foreign_keys = ON;

ALTER TABLE community_channel_messages
  ADD COLUMN reply_to_message_id TEXT REFERENCES community_channel_messages(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_community_channel_messages_reply
  ON community_channel_messages(reply_to_message_id, created_at);

CREATE TABLE IF NOT EXISTS community_channel_reactions (
  message_id TEXT NOT NULL REFERENCES community_channel_messages(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (message_id, profile_id, emoji),
  CHECK (emoji IN ('👍', '❤️', '🎉'))
);
CREATE INDEX IF NOT EXISTS idx_community_channel_reactions_message
  ON community_channel_reactions(message_id, emoji, created_at);

CREATE TABLE IF NOT EXISTS community_channel_read_states (
  channel_id TEXT NOT NULL REFERENCES community_channels(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  last_read_message_id TEXT REFERENCES community_channel_messages(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (channel_id, profile_id)
);
CREATE INDEX IF NOT EXISTS idx_community_channel_read_states_profile
  ON community_channel_read_states(profile_id, updated_at DESC);
