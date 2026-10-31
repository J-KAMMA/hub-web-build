PRAGMA foreign_keys = ON;
ALTER TABLE notifications ADD COLUMN aggregation_count INTEGER NOT NULL DEFAULT 1 CHECK(aggregation_count>=1);
ALTER TABLE notifications ADD COLUMN last_event_at TEXT;
CREATE TRIGGER IF NOT EXISTS aggregate_unread_notifications BEFORE INSERT ON notifications
WHEN EXISTS(SELECT 1 FROM notifications WHERE receiver_profile_id=NEW.receiver_profile_id AND notification_type=NEW.notification_type AND target_type=NEW.target_type AND target_id=NEW.target_id AND is_read=0 AND created_at>=datetime('now','-10 minutes'))
BEGIN
 UPDATE notifications SET aggregation_count=aggregation_count+1,last_event_at=NEW.created_at WHERE id=(SELECT id FROM notifications WHERE receiver_profile_id=NEW.receiver_profile_id AND notification_type=NEW.notification_type AND target_type=NEW.target_type AND target_id=NEW.target_id AND is_read=0 ORDER BY created_at DESC LIMIT 1);
 SELECT RAISE(IGNORE);
END;
CREATE TRIGGER IF NOT EXISTS preserve_social_post_revision BEFORE UPDATE OF body ON social_posts WHEN OLD.body<>NEW.body
BEGIN INSERT INTO social_post_revisions(id,post_id,editor_profile_id,previous_body,created_at) VALUES(lower(hex(randomblob(16))),OLD.id,OLD.author_profile_id,OLD.body,datetime('now')); END;
