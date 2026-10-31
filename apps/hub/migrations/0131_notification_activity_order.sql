CREATE INDEX IF NOT EXISTS idx_notifications_receiver_activity
  ON notifications(receiver_profile_id, is_read, last_event_at, created_at);
