ALTER TABLE threads ADD COLUMN thread_format TEXT
  CHECK (thread_format IN ('question','information','discussion','recruitment','issue','chat'));

UPDATE threads SET thread_format = thread_type WHERE thread_format IS NULL;

ALTER TABLE threads ADD COLUMN deadline TEXT;

CREATE INDEX IF NOT EXISTS idx_threads_format_updated
  ON threads(thread_format, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_threads_recruitment_deadline
  ON threads(deadline, updated_at DESC)
  WHERE thread_format = 'recruitment' AND deadline IS NOT NULL;

CREATE TABLE IF NOT EXISTS thread_summary_reports (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  reporter_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  details TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','rejected')),
  created_at TEXT NOT NULL,
  UNIQUE(thread_id, reporter_profile_id, status)
);

CREATE INDEX IF NOT EXISTS idx_thread_summary_reports_queue
  ON thread_summary_reports(status, created_at DESC);
