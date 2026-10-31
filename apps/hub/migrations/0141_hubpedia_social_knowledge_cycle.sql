-- Social discussion may propose knowledge, but it is never treated as
-- authoritative article evidence. Accepted links preserve provenance only.
CREATE TABLE IF NOT EXISTS hubpedia_social_knowledge_links (
  id TEXT PRIMARY KEY,
  article_slug TEXT NOT NULL COLLATE NOCASE,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  relation TEXT NOT NULL DEFAULT 'origin_signal',
  candidate_id TEXT REFERENCES hubpedia_article_candidates(id) ON DELETE SET NULL,
  proposed_by_profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  reviewed_by_profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'proposed',
  created_at TEXT NOT NULL,
  reviewed_at TEXT,
  CHECK (length(article_slug) BETWEEN 1 AND 160),
  CHECK (source_type IN ('social_post','thread_post','thread')),
  CHECK (relation IN ('origin_signal','discussion','contradiction_report')),
  CHECK (status IN ('proposed','accepted','rejected','superseded')),
  UNIQUE (article_slug, source_type, source_id, relation)
);
CREATE INDEX IF NOT EXISTS idx_hubpedia_social_knowledge_links_article
  ON hubpedia_social_knowledge_links(article_slug, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hubpedia_social_knowledge_links_source
  ON hubpedia_social_knowledge_links(source_type, source_id, status);

CREATE TABLE IF NOT EXISTS hubpedia_article_discussions (
  article_slug TEXT NOT NULL COLLATE NOCASE,
  thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  created_by_profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (article_slug, thread_id),
  CHECK (length(article_slug) BETWEEN 1 AND 160),
  CHECK (status IN ('active','archived'))
);
CREATE INDEX IF NOT EXISTS idx_hubpedia_article_discussions_article
  ON hubpedia_article_discussions(article_slug, status, updated_at DESC);
