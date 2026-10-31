-- Hubpedia hybrid, phase 3 backend (docs/hubpedia-hybrid/DESIGN.md sections 5, 8 and 9).
--
-- 1. Patrol role: appointed by the Hub operator (owner) at first, revocable.
-- 2. Temporary per-editor suspensions with a reason; every change is audited.
-- 3. Claim-level proposals: a detail row beside a hubpedia_wiki_proposals row.
-- 4. Sensitive-category flag per article (medical / legal / financial): human
--    review is mandatory, AI-only revisions never auto-publish.
-- 5. Anchored discussion (claim / paragraph) on the existing wiki discussions.
-- 6. Queue for "explain this paragraph" requests (no paid calls are made).
-- 7. Audit detail column and a keyset index for the recent-changes feed.

CREATE TABLE IF NOT EXISTS hubpedia_wiki_patrol (
  profile_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  appointed_by TEXT NOT NULL,
  appointed_at TEXT NOT NULL,
  revoked_at TEXT,
  revoked_by TEXT,
  CHECK ((revoked_at IS NULL AND revoked_by IS NULL) OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS hubpedia_wiki_suspensions (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 3 AND 500),
  suspended_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  lifted_at TEXT,
  lifted_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_hubpedia_wiki_suspensions_profile
  ON hubpedia_wiki_suspensions(profile_id, expires_at DESC);

ALTER TABLE hubpedia_wiki_audit ADD COLUMN detail TEXT;

ALTER TABLE hubpedia_wiki_articles ADD COLUMN sensitive_category TEXT
  CHECK (sensitive_category IS NULL OR sensitive_category IN ('medical', 'legal', 'financial'));

ALTER TABLE hubpedia_wiki_discussions ADD COLUMN anchor_type TEXT
  CHECK (anchor_type IS NULL OR anchor_type IN ('claim', 'paragraph'));
ALTER TABLE hubpedia_wiki_discussions ADD COLUMN anchor_id TEXT
  CHECK (anchor_id IS NULL OR length(anchor_id) BETWEEN 1 AND 80);
CREATE INDEX IF NOT EXISTS idx_hubpedia_wiki_discussions_anchor
  ON hubpedia_wiki_discussions(article_key, anchor_type, anchor_id, created_at);

CREATE TABLE IF NOT EXISTS hubpedia_claim_proposals (
  id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL UNIQUE REFERENCES hubpedia_wiki_proposals(id) ON DELETE CASCADE,
  article_key TEXT NOT NULL REFERENCES hubpedia_wiki_articles(article_key) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('add_claim', 'modify_claim', 'add_evidence', 'add_refuting_evidence')),
  claim_id TEXT REFERENCES encyclopedia_claims(id) ON DELETE SET NULL,
  topic_id TEXT,
  statement TEXT CHECK (statement IS NULL OR length(statement) BETWEEN 1 AND 2000),
  evidence_kind TEXT CHECK (evidence_kind IS NULL OR evidence_kind IN ('source', 'hub_item')),
  source_url TEXT,
  hub_kind TEXT,
  hub_item_id TEXT,
  quote TEXT CHECK (quote IS NULL OR length(quote) <= 200),
  applied_at TEXT,
  created_at TEXT NOT NULL,
  CHECK (
    evidence_kind IS NULL
    OR (evidence_kind = 'source' AND source_url IS NOT NULL)
    OR (evidence_kind = 'hub_item' AND hub_kind IS NOT NULL AND hub_item_id IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_hubpedia_claim_proposals_claim ON hubpedia_claim_proposals(claim_id);
CREATE INDEX IF NOT EXISTS idx_hubpedia_claim_proposals_article ON hubpedia_claim_proposals(article_key, created_at DESC);

CREATE TABLE IF NOT EXISTS hubpedia_explain_requests (
  id TEXT PRIMARY KEY,
  article_key TEXT NOT NULL REFERENCES hubpedia_wiki_articles(article_key) ON DELETE CASCADE,
  anchor_type TEXT NOT NULL CHECK (anchor_type IN ('claim', 'paragraph')),
  anchor_id TEXT NOT NULL CHECK (length(anchor_id) BETWEEN 1 AND 80),
  requested_by TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'ready', 'failed')),
  explanation TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_hubpedia_explain_requests_anchor
  ON hubpedia_explain_requests(article_key, anchor_type, anchor_id, status);
CREATE INDEX IF NOT EXISTS idx_hubpedia_explain_requests_profile
  ON hubpedia_explain_requests(requested_by, created_at DESC);

-- Keyset index for the recent-changes feed (created_at DESC, id DESC).
CREATE INDEX IF NOT EXISTS idx_hubpedia_wiki_revisions_created
  ON hubpedia_wiki_revisions(created_at DESC, id DESC);
