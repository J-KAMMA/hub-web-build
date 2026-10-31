ALTER TABLE video_import_jobs ADD COLUMN control_state TEXT NOT NULL DEFAULT 'active'
  CHECK (control_state IN ('active', 'paused', 'cancelled'));
ALTER TABLE video_import_jobs ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS youtube_api_quota_usage (
  quota_date TEXT PRIMARY KEY,
  used_units INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
