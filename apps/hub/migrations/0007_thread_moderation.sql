PRAGMA foreign_keys = ON;

-- Thread moderation remains inside Hub and references only Hub-local,
-- pseudonymous profile identifiers.
ALTER TABLE thread_posts ADD COLUMN is_anonymous INTEGER NOT NULL DEFAULT 0
  CHECK (is_anonymous IN (0, 1));
ALTER TABLE thread_posts ADD COLUMN edited_at TEXT;
ALTER TABLE thread_posts ADD COLUMN deleted_at TEXT;

CREATE TABLE IF NOT EXISTS thread_post_revisions (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES thread_posts(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK (length(body) BETWEEN 1 AND 20000)
);
CREATE INDEX IF NOT EXISTS idx_thread_post_revisions_post_created
  ON thread_post_revisions(post_id, created_at DESC);

CREATE TABLE IF NOT EXISTS thread_post_reports (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES thread_posts(id) ON DELETE CASCADE,
  reporter_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  resolution_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  CHECK (reason IN ('harassment','spam','privacy','misinformation','other')),
  CHECK (status IN ('open','resolved','dismissed')),
  CHECK (length(details) <= 500),
  CHECK (length(resolution_note) <= 1000),
  CHECK ((status = 'open' AND resolved_at IS NULL) OR (status <> 'open' AND resolved_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_thread_post_reports_open_reporter
  ON thread_post_reports(post_id, reporter_profile_id)
  WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_thread_post_reports_status_created
  ON thread_post_reports(status, created_at DESC);

CREATE TABLE IF NOT EXISTS thread_user_controls (
  owner_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  target_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  muted INTEGER NOT NULL DEFAULT 0,
  blocked INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_profile_id, target_profile_id),
  CHECK (owner_profile_id <> target_profile_id),
  CHECK (muted IN (0, 1)),
  CHECK (blocked IN (0, 1))
);
CREATE INDEX IF NOT EXISTS idx_thread_user_controls_target
  ON thread_user_controls(target_profile_id, blocked, muted);
