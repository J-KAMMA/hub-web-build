PRAGMA foreign_keys = OFF;

CREATE TABLE community_notification_event_fk_repair_guard (
  invalid_count INTEGER NOT NULL CHECK (invalid_count = 0)
);

INSERT INTO community_notification_event_fk_repair_guard(invalid_count)
SELECT COUNT(*)
FROM community_notification_events AS event
LEFT JOIN notifications AS notification
  ON notification.id = event.notification_id
WHERE notification.id IS NULL;

DROP TABLE community_notification_event_fk_repair_guard;

ALTER TABLE community_notification_events
  RENAME TO community_notification_events_before_fk_repair;

CREATE TABLE community_notification_events (
  notification_id TEXT PRIMARY KEY REFERENCES notifications(id) ON DELETE CASCADE,
  community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL REFERENCES community_channels(id) ON DELETE CASCADE,
  event_kind TEXT NOT NULL CHECK (event_kind IN ('mention', 'reply')),
  created_at TEXT NOT NULL
);

INSERT INTO community_notification_events(
  notification_id,
  community_id,
  channel_id,
  event_kind,
  created_at
)
SELECT
  notification_id,
  community_id,
  channel_id,
  event_kind,
  created_at
FROM community_notification_events_before_fk_repair;

DROP TABLE community_notification_events_before_fk_repair;

CREATE INDEX idx_community_notification_events_scope
  ON community_notification_events(community_id, channel_id, created_at DESC);

PRAGMA foreign_keys = ON;
