CREATE TABLE IF NOT EXISTS hub_admin_mfa_recovery_rotation_state (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  operation_id TEXT,
  locked_until TEXT,
  last_completed_at TEXT,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO hub_admin_mfa_recovery_rotation_state(
  id,
  operation_id,
  locked_until,
  last_completed_at,
  updated_at
) VALUES(1, NULL, NULL, NULL, '1970-01-01T00:00:00.000Z');
