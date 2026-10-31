PRAGMA foreign_keys = ON;

-- Community moderation remains Hub-local and pseudonymous. No Identity,
-- commerce, email, phone, legal identity, or cross-service identifiers belong here.
ALTER TABLE community_memberships
  ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'muted', 'banned'));

ALTER TABLE community_channel_messages
  ADD COLUMN edited_at TEXT;

CREATE TABLE IF NOT EXISTS community_message_reports (
  id TEXT PRIMARY KEY,
  community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL REFERENCES community_channels(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL REFERENCES community_channel_messages(id) ON DELETE CASCADE,
  reporter_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  CHECK (reason IN ('spam', 'harassment', 'other')),
  CHECK (status IN ('open', 'resolved', 'dismissed'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_community_message_reports_open
  ON community_message_reports(message_id, reporter_profile_id)
  WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_community_message_reports_queue
  ON community_message_reports(community_id, status, created_at);
