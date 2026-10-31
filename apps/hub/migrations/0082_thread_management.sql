ALTER TABLE threads ADD COLUMN status TEXT NOT NULL DEFAULT 'open'
  CHECK (status IN ('open', 'closed', 'archived'));

CREATE TABLE IF NOT EXISTS thread_move_requests (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  requested_by_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  destination_board_key TEXT NOT NULL CHECK (length(destination_board_key) BETWEEN 3 AND 80),
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 10 AND 500),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'approved', 'dismissed')),
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_thread_move_requests_open
  ON thread_move_requests(thread_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_thread_move_requests_queue
  ON thread_move_requests(status, created_at DESC);
