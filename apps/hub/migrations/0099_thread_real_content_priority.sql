UPDATE threads
SET status = 'archived'
WHERE id LIKE 'mock-thread-%';

CREATE INDEX IF NOT EXISTS idx_threads_public_board_updated
ON threads(status, board_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_threads_public_updated
ON threads(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS thread_safety_settings (
  setting_key TEXT PRIMARY KEY,
  setting_value INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO thread_safety_settings(setting_key,setting_value,updated_at)
VALUES('auto_hide_report_threshold',3,CURRENT_TIMESTAMP);
