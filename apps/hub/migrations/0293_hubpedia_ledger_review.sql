-- Hubpedia ledger, Lane D (docs/hubpedia-ledger.md sections 5, 6 and 8).
--
-- 1. hubpedia_revision_reviews: a human reviewer's verdict on one article
--    revision. An 'approved' row for the current revision is what makes an
--    AI-written ledger version indexable. A new revision has no row, so it
--    drops out of the index until someone reviews it again.
-- 2. hubpedia_ledger_regen_queue: one row per article that needs a targeted
--    regeneration, however many causes arrive.

CREATE TABLE IF NOT EXISTS hubpedia_revision_reviews (
  revision_id TEXT PRIMARY KEY REFERENCES encyclopedia_article_revisions(id) ON DELETE CASCADE,
  reviewer_profile_id TEXT NOT NULL,
  verdict TEXT NOT NULL CHECK (verdict IN ('approved', 'rejected')),
  scope_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(scope_json)),
  reviewed_at TEXT NOT NULL,
  CHECK (length(reviewer_profile_id) BETWEEN 1 AND 200)
);

CREATE INDEX IF NOT EXISTS idx_hubpedia_revision_reviews_verdict
  ON hubpedia_revision_reviews(verdict, revision_id);

CREATE TABLE IF NOT EXISTS hubpedia_ledger_regen_queue (
  article_id TEXT PRIMARY KEY REFERENCES encyclopedia_articles(id) ON DELETE CASCADE,
  reasons_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(reasons_json) AND json_type(reasons_json) = 'array'),
  first_queued_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_hubpedia_ledger_regen_queue_status
  ON hubpedia_ledger_regen_queue(status, article_id);
