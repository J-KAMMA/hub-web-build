PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS community_guide_pages (
  id TEXT PRIMARY KEY,
  community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_by_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (community_id, slug),
  CHECK (length(title) BETWEEN 1 AND 120),
  CHECK (length(body) BETWEEN 1 AND 30000),
  CHECK (version >= 1)
);

CREATE TABLE IF NOT EXISTS community_guide_proposals (
  id TEXT PRIMARY KEY,
  community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  page_id TEXT REFERENCES community_guide_pages(id) ON DELETE CASCADE,
  author_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  proposed_title TEXT NOT NULL,
  proposed_body TEXT NOT NULL,
  summary TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  base_version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  merged_at TEXT,
  merged_by_profile_id TEXT REFERENCES profiles(id) ON DELETE RESTRICT,
  CHECK (status IN ('open', 'changes_requested', 'merged', 'closed')),
  CHECK (length(title) BETWEEN 1 AND 120),
  CHECK (length(proposed_body) BETWEEN 1 AND 30000),
  CHECK (length(summary) BETWEEN 1 AND 500)
);

CREATE TABLE IF NOT EXISTS community_guide_reviews (
  id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL REFERENCES community_guide_proposals(id) ON DELETE CASCADE,
  author_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  body TEXT NOT NULL,
  decision TEXT NOT NULL DEFAULT 'comment',
  created_at TEXT NOT NULL,
  CHECK (decision IN ('comment', 'approve', 'request_changes')),
  CHECK (length(body) BETWEEN 1 AND 2000)
);

CREATE INDEX IF NOT EXISTS idx_community_guide_proposals_status
  ON community_guide_proposals(community_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_community_guide_reviews_proposal
  ON community_guide_reviews(proposal_id, created_at);
