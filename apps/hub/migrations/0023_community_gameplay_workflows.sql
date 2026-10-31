PRAGMA foreign_keys = ON;

-- Questions and party recruitment use a small explicit workflow. The state
-- remains community-local and never participates in Vault authorization.
ALTER TABLE community_channel_messages
  ADD COLUMN workflow_status TEXT NOT NULL DEFAULT 'open'
  CHECK (workflow_status IN ('open', 'resolved', 'closed'));

CREATE INDEX IF NOT EXISTS idx_community_channel_messages_workflow
  ON community_channel_messages(channel_id, kind, workflow_status, created_at DESC);
