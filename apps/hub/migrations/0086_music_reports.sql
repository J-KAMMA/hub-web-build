CREATE TABLE IF NOT EXISTS music_reports (
  id TEXT PRIMARY KEY,
  music_work_id TEXT NOT NULL,
  reporter_profile_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('not_music','duplicate','wrong_metadata','unavailable','rights','other')),
  details TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','dismissed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (music_work_id, reporter_profile_id)
);
CREATE INDEX IF NOT EXISTS idx_music_reports_status_created ON music_reports(status, created_at DESC);
