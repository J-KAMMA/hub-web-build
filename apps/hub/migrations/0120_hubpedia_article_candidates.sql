CREATE TABLE IF NOT EXISTS hubpedia_article_candidates (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL CHECK (source_type IN ('social_post', 'thread_post')),
  source_id TEXT NOT NULL,
  proposed_title TEXT NOT NULL,
  source_excerpt TEXT NOT NULL,
  proposer_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  signal_count INTEGER NOT NULL DEFAULT 1 CHECK (signal_count > 0),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'reviewing', 'accepted', 'rejected', 'merged')),
  reviewer_profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  review_note TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (length(proposed_title) BETWEEN 2 AND 160),
  CHECK (length(source_excerpt) BETWEEN 1 AND 2000),
  UNIQUE (source_type, source_id)
);

CREATE INDEX IF NOT EXISTS idx_hubpedia_article_candidates_status
  ON hubpedia_article_candidates(status, signal_count DESC, created_at);

CREATE TABLE IF NOT EXISTS hubpedia_article_candidate_signals (
  candidate_id TEXT NOT NULL REFERENCES hubpedia_article_candidates(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (candidate_id, profile_id)
);
