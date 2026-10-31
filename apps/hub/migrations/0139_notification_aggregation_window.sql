DROP TRIGGER IF EXISTS aggregate_unread_notifications;

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
      AND datetime(created_at) >= datetime('now', '-10 minutes')
    ORDER BY datetime(created_at) DESC, id DESC
    LIMIT 1
  );
  SELECT RAISE(IGNORE);
END;
