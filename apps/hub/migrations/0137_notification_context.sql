ALTER TABLE notifications
  ADD COLUMN notification_context TEXT
  CHECK (notification_context IS NULL OR notification_context IN ('mention'));
