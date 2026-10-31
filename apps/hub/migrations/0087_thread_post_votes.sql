CREATE TABLE IF NOT EXISTS thread_post_votes (
  post_id TEXT NOT NULL REFERENCES thread_posts(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('up', 'down')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (post_id, profile_id)
);

CREATE INDEX IF NOT EXISTS idx_thread_post_votes_post_kind
  ON thread_post_votes(post_id, kind);

CREATE INDEX IF NOT EXISTS idx_thread_post_votes_profile_updated
  ON thread_post_votes(profile_id, updated_at DESC);
