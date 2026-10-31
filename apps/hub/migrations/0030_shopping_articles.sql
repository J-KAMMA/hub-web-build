-- Automatically generated shopping editorial drafts.
-- Sources are limited to the approved, static shop catalog. Drafts are never
-- made public by the scheduled generator.
CREATE TABLE IF NOT EXISTS shopping_articles (
  id TEXT PRIMARY KEY,
  dedupe_key TEXT NOT NULL UNIQUE,
  region TEXT NOT NULL CHECK (region IN ('jp', 'na', 'kr', 'zh')),
  language TEXT NOT NULL CHECK (language IN ('ja', 'en', 'ko', 'zh-CN')),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
  summary TEXT NOT NULL CHECK (length(summary) BETWEEN 1 AND 500),
  body_markdown TEXT NOT NULL CHECK (length(body_markdown) BETWEEN 1 AND 12000),
  source_kind TEXT NOT NULL DEFAULT 'approved_catalog'
    CHECK (source_kind = 'approved_catalog'),
  source_refs_json TEXT NOT NULL CHECK (json_valid(source_refs_json)),
  generator_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_at TEXT,
  CHECK (
    (status = 'published' AND published_at IS NOT NULL)
    OR (status <> 'published' AND published_at IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_shopping_articles_status_created
  ON shopping_articles(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_shopping_articles_region_language_status
  ON shopping_articles(region, language, status, created_at DESC);
