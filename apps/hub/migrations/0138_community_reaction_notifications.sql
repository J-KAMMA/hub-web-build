PRAGMA foreign_keys = OFF;

ALTER TABLE notifications RENAME TO notifications_before_community_reactions;

CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  receiver_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  actor_profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  notification_type TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  text TEXT NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  aggregation_count INTEGER NOT NULL DEFAULT 1 CHECK(aggregation_count >= 1),
  last_event_at TEXT,
  notification_context TEXT,
  CHECK (notification_type IN (
    'social_reply',
    'social_repost',
    'social_reaction',
    'social_bookmark',
    'thread_reply',
    'message_received',
    'followed',
    'system'
  )),
  CHECK (target_type IN (
    'social_post',
    'vault_content',
    'profile',
    'thread',
    'thread_post',
    'community_message',
    'message_conversation',
    'system'
  )),
  CHECK (is_read IN (0, 1)),
  CHECK (length(text) <= 1000),
  CHECK (notification_context IS NULL OR notification_context IN ('mention'))
);

INSERT INTO notifications (
  id,
  receiver_profile_id,
  actor_profile_id,
  notification_type,
  target_type,
  target_id,
  text,
  is_read,
  created_at,
  aggregation_count,
  last_event_at,
  notification_context
)
SELECT
  id,
  receiver_profile_id,
  actor_profile_id,
  notification_type,
  target_type,
  target_id,
  text,
  is_read,
  created_at,
  aggregation_count,
  last_event_at,
  notification_context
FROM notifications_before_community_reactions;

DROP TABLE notifications_before_community_reactions;

CREATE INDEX idx_notifications_receiver_unread
  ON notifications(receiver_profile_id, is_read, created_at DESC);
CREATE INDEX idx_notifications_receiver_activity
  ON notifications(receiver_profile_id, is_read, last_event_at, created_at);

CREATE TRIGGER aggregate_unread_notifications
BEFORE INSERT ON notifications
WHEN EXISTS(
  SELECT 1
  FROM notifications
  WHERE receiver_profile_id = NEW.receiver_profile_id
    AND notification_type = NEW.notification_type
    AND target_type = NEW.target_type
    AND target_id = NEW.target_id
    AND is_read = 0
    AND datetime(created_at) >= datetime('now', '-10 minutes')
)
BEGIN
  UPDATE notifications
  SET aggregation_count = aggregation_count + 1,
      last_event_at = NEW.created_at
  WHERE id = (
    SELECT id
    FROM notifications
    WHERE receiver_profile_id = NEW.receiver_profile_id
      AND notification_type = NEW.notification_type
      AND target_type = NEW.target_type
      AND target_id = NEW.target_id
      AND is_read = 0
    ORDER BY created_at DESC
    LIMIT 1
  );
  SELECT RAISE(IGNORE);
END;

PRAGMA foreign_keys = ON;
