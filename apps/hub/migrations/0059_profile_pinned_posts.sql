PRAGMA foreign_keys = ON;

-- A profile may feature one of its own public account posts. Ownership is
-- re-checked by the write API before this row is created or replaced.
CREATE TABLE IF NOT EXISTS profile_pinned_posts (
  profile_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  post_id TEXT NOT NULL UNIQUE REFERENCES social_posts(id) ON DELETE CASCADE,
  pinned_at TEXT NOT NULL,
  CHECK (length(profile_id) > 0),
  CHECK (length(post_id) > 0)
);

CREATE INDEX IF NOT EXISTS idx_profile_pinned_posts_post
  ON profile_pinned_posts(post_id);
