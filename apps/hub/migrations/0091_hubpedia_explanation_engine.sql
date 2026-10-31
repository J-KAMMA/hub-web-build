CREATE TABLE IF NOT EXISTS hubpedia_explanation_blocks (
  id TEXT PRIMARY KEY,
  article_slug TEXT NOT NULL,
  revision_key TEXT NOT NULL,
  block_key TEXT NOT NULL,
  block_role TEXT NOT NULL,
  heading TEXT NOT NULL,
  body_markdown TEXT NOT NULL,
  subject_concept TEXT,
  causes TEXT NOT NULL DEFAULT '[]',
  effects TEXT NOT NULL DEFAULT '[]',
  examples TEXT NOT NULL DEFAULT '[]',
  exceptions TEXT NOT NULL DEFAULT '[]',
  related_concepts TEXT NOT NULL DEFAULT '[]',
  source_urls TEXT NOT NULL DEFAULT '[]',
  position INTEGER NOT NULL,
  last_verified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(article_slug, revision_key, block_key)
);
CREATE INDEX IF NOT EXISTS hubpedia_explanation_blocks_revision_idx
  ON hubpedia_explanation_blocks(article_slug, revision_key, position);

CREATE TABLE IF NOT EXISTS hubpedia_explanation_block_claims (
  block_id TEXT NOT NULL REFERENCES hubpedia_explanation_blocks(id) ON DELETE CASCADE,
  claim_id TEXT NOT NULL,
  relation TEXT NOT NULL DEFAULT 'supports',
  PRIMARY KEY(block_id, claim_id)
);

CREATE TABLE IF NOT EXISTS hubpedia_explanation_variants (
  id TEXT PRIMARY KEY,
  article_slug TEXT NOT NULL,
  revision_key TEXT NOT NULL,
  locale TEXT NOT NULL,
  audience TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  body_markdown TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  generation_method TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ready',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(article_slug, revision_key, locale, audience, source_hash)
);
CREATE INDEX IF NOT EXISTS hubpedia_explanation_variants_lookup_idx
  ON hubpedia_explanation_variants(article_slug, revision_key, locale, audience, updated_at DESC);
