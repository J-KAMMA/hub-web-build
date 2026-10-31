PRAGMA foreign_keys = ON;

ALTER TABLE community_channel_messages
  ADD COLUMN bot_id TEXT REFERENCES community_bots(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_community_channel_messages_bot
  ON community_channel_messages(bot_id, created_at DESC);
