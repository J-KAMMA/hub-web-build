PRAGMA foreign_keys = ON;

-- Rebuild the report table to add harassment, which the report API already
-- exposed but the original CHECK constraint did not permit.
ALTER TABLE social_post_reports RENAME TO social_post_reports_legacy;

CREATE TABLE social_post_reports (
  id TEXT PRIMARY KEY,
  reporter_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  post_id TEXT NOT NULL REFERENCES social_posts(id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK (reason IN ('image_safety', 'sexual', 'violence', 'copyright', 'privacy', 'harassment', 'spam', 'other')),
  details TEXT NOT NULL DEFAULT '' CHECK (length(details) <= 500),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewed', 'dismissed', 'actioned')),
  created_at TEXT NOT NULL,
  reviewed_at TEXT
);

INSERT INTO social_post_reports
  (id,reporter_profile_id,post_id,reason,details,status,created_at,reviewed_at)
SELECT id,reporter_profile_id,post_id,reason,details,status,created_at,reviewed_at
FROM social_post_reports_legacy;

DROP TABLE social_post_reports_legacy;

CREATE UNIQUE INDEX idx_social_post_reports_open_reporter
  ON social_post_reports(reporter_profile_id, post_id)
  WHERE status = 'open';
CREATE INDEX idx_social_post_reports_queue
  ON social_post_reports(status, created_at DESC);
CREATE TRIGGER social_report_rate_limit BEFORE INSERT ON social_post_reports
  WHEN (SELECT COUNT(*) FROM social_post_reports
    WHERE reporter_profile_id=NEW.reporter_profile_id
      AND created_at>=datetime('now','-1 hour'))>=10
  BEGIN SELECT RAISE(ABORT,'report_rate_limit'); END;

CREATE TABLE IF NOT EXISTS social_post_moderation_cases (
  post_id TEXT PRIMARY KEY REFERENCES social_posts(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('auto_held', 'hidden', 'restored')),
  reason TEXT NOT NULL DEFAULT '' CHECK (length(reason) <= 1000),
  report_count INTEGER NOT NULL DEFAULT 0 CHECK (report_count >= 0),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  opened_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_social_post_moderation_cases_queue
  ON social_post_moderation_cases(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS social_post_moderation_appeals (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES social_posts(id) ON DELETE CASCADE,
  author_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  message TEXT NOT NULL CHECK (length(message) BETWEEN 20 AND 2000),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'accepted', 'rejected')),
  resolution_note TEXT NOT NULL DEFAULT '' CHECK (length(resolution_note) <= 1000),
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_social_post_moderation_appeals_open
  ON social_post_moderation_appeals(post_id, author_profile_id)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_social_post_moderation_appeals_queue
  ON social_post_moderation_appeals(status, created_at DESC);
