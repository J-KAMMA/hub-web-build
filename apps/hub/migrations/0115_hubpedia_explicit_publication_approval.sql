-- Legacy Hubpedia content remains stored for rebuilding, but is not public.
UPDATE hubpedia_articles
SET status = 'archived',
    updated_at = datetime('now'),
    published_at = NULL
WHERE status = 'published';

UPDATE encyclopedia_articles
SET status = 'archived',
    updated_at = unixepoch('now') * 1000
WHERE status = 'published';

CREATE TABLE IF NOT EXISTS hubpedia_publication_approvals (
  article_slug TEXT PRIMARY KEY COLLATE NOCASE,
  policy_version TEXT NOT NULL,
  approved_revision_key TEXT NOT NULL,
  approved_at TEXT NOT NULL,
  revoked_at TEXT,
  CHECK (length(article_slug) BETWEEN 1 AND 160),
  CHECK (length(policy_version) BETWEEN 1 AND 100),
  CHECK (length(approved_revision_key) BETWEEN 1 AND 200)
);

CREATE INDEX IF NOT EXISTS idx_hubpedia_publication_approvals_active
  ON hubpedia_publication_approvals(revoked_at, approved_at DESC);
