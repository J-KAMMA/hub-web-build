CREATE TABLE IF NOT EXISTS social_post_reports (
  id TEXT PRIMARY KEY,
  reporter_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  post_id TEXT NOT NULL REFERENCES social_posts(id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK (reason IN ('image_safety', 'sexual', 'violence', 'copyright', 'privacy', 'spam', 'other')),
  details TEXT NOT NULL DEFAULT '' CHECK (length(details) <= 500),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewed', 'dismissed', 'actioned')),
  created_at TEXT NOT NULL,
  reviewed_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_social_post_reports_open_reporter
  ON social_post_reports(reporter_profile_id, post_id)
  WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_social_post_reports_queue
  ON social_post_reports(status, created_at DESC);

ALTER TABLE social_post_images ADD COLUMN safety_status TEXT NOT NULL DEFAULT 'clean'
  CHECK (safety_status IN ('pending', 'clean', 'sensitive', 'rejected'));
ALTER TABLE social_post_images ADD COLUMN safety_labels_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE social_post_images ADD COLUMN reviewed_at TEXT;

