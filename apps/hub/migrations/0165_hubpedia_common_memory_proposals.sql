-- Human and delegated-agent contributions enter a private review queue.
-- Nothing in this table is authoritative evidence or public Hubpedia content.
CREATE TABLE IF NOT EXISTS hubpedia_memory_proposals (
  id TEXT PRIMARY KEY,
  proposer_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  contributor_type TEXT NOT NULL CHECK (contributor_type IN ('human', 'agent')),
  agent_grant_id TEXT REFERENCES hub_agent_grants(id) ON DELETE RESTRICT,
  actor_key TEXT NOT NULL,
  memory_kind TEXT NOT NULL CHECK (memory_kind IN ('claim', 'source', 'correction', 'question', 'firsthand')),
  proposed_title TEXT NOT NULL,
  content TEXT NOT NULL,
  source_urls_json TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(source_urls_json) AND json_type(source_urls_json) = 'array'),
  target_article_slug TEXT,
  fingerprint TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'reviewing', 'accepted', 'rejected', 'merged')),
  review_note TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (length(proposed_title) BETWEEN 2 AND 160),
  CHECK (length(content) BETWEEN 1 AND 8000),
  CHECK (length(idempotency_key) BETWEEN 8 AND 100),
  CHECK (
    (contributor_type = 'human' AND agent_grant_id IS NULL)
    OR (contributor_type = 'agent' AND agent_grant_id IS NOT NULL)
  ),
  UNIQUE (actor_key, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_hubpedia_memory_proposals_review
  ON hubpedia_memory_proposals(status, created_at);

CREATE INDEX IF NOT EXISTS idx_hubpedia_memory_proposals_profile
  ON hubpedia_memory_proposals(proposer_profile_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_hubpedia_memory_proposals_fingerprint
  ON hubpedia_memory_proposals(fingerprint, status);
