CREATE TABLE IF NOT EXISTS post_pushes (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  post_id TEXT NOT NULL REFERENCES social_posts(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (profile_id, post_id)
);

CREATE INDEX IF NOT EXISTS idx_post_pushes_post_created
  ON post_pushes (post_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_post_pushes_profile_created
  ON post_pushes (profile_id, created_at DESC);
