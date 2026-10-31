PRAGMA foreign_keys = ON;

-- Structured community posts make game guides, questions, and party
-- recruitment discoverable without mixing them with BBS threads.
ALTER TABLE community_channel_messages
  ADD COLUMN kind TEXT NOT NULL DEFAULT 'chat'
  CHECK (kind IN ('chat', 'guide', 'question', 'party'));

ALTER TABLE community_channel_messages
  ADD COLUMN pinned_at TEXT;

ALTER TABLE community_channel_messages
  ADD COLUMN pinned_by_profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_community_channel_messages_kind
  ON community_channel_messages(channel_id, kind, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_community_channel_messages_pinned
  ON community_channel_messages(channel_id, pinned_at DESC)
  WHERE pinned_at IS NOT NULL;
