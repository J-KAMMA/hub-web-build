ALTER TABLE notification_preferences
  ADD COLUMN commerce_payments_enabled INTEGER NOT NULL DEFAULT 1
  CHECK (commerce_payments_enabled IN (0, 1));

ALTER TABLE notification_preferences
  ADD COLUMN commerce_delivery_enabled INTEGER NOT NULL DEFAULT 1
  CHECK (commerce_delivery_enabled IN (0, 1));

ALTER TABLE notification_preferences
  ADD COLUMN commerce_returns_enabled INTEGER NOT NULL DEFAULT 1
  CHECK (commerce_returns_enabled IN (0, 1));
