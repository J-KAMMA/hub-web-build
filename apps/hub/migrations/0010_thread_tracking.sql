PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS thread_tracking (
  thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  following INTEGER NOT NULL DEFAULT 0,
  last_read_post_no INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (thread_id, profile_id),
  CHECK (following IN (0, 1)),
  CHECK (last_read_post_no >= 0)
);
CREATE INDEX IF NOT EXISTS idx_thread_tracking_profile_following
  ON thread_tracking(profile_id, following, updated_at DESC);
