PRAGMA foreign_keys = ON;

ALTER TABLE social_posts ADD COLUMN audience TEXT NOT NULL DEFAULT 'public'
  CHECK (audience IN ('public','followers'));

CREATE TABLE IF NOT EXISTS home_feed_read_positions (
  profile_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  last_seen_post_id TEXT REFERENCES social_posts(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_home_feed_read_positions_updated
  ON home_feed_read_positions(updated_at DESC);

CREATE TABLE IF NOT EXISTS social_scheduled_posts (
  id TEXT PRIMARY KEY,
  author_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  audience TEXT NOT NULL DEFAULT 'public' CHECK (audience IN ('public','followers')),
  scheduled_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','published','cancelled','failed')),
  created_at TEXT NOT NULL,
  CHECK (length(body) BETWEEN 1 AND 20000)
);

CREATE INDEX IF NOT EXISTS idx_social_scheduled_posts_due
  ON social_scheduled_posts(status, scheduled_at);
