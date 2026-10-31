-- Hub-local retry records survive message deletion so a replay cannot recreate it.
CREATE TABLE community_message_operations (
  message_id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL REFERENCES community_channels(id) ON DELETE CASCADE,
  request_fingerprint TEXT NOT NULL CHECK(length(request_fingerprint) = 64),
  created_at TEXT NOT NULL,
  completed_at TEXT,
  deleted_at TEXT
);

CREATE TRIGGER community_message_operation_deleted
AFTER DELETE ON community_channel_messages
BEGIN
  UPDATE community_message_operations
  SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE message_id = OLD.id;
END;
