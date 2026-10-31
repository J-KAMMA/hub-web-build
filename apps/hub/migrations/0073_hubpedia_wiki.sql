-- Community Wiki workflow.  `article_key` is a stable, namespaced key:
-- static:<seed slug>, d1:<hubpedia_articles.id>, encyclopedia:<encyclopedia_articles.id>.
--
-- Migration 0072 introduced an earlier article_slug-based draft of these
-- tables. No application release wrote production data between 0072 and this
-- replacement migration. Drop that incompatible draft before creating the
-- final article_key schema so a new database can apply the full migration
-- history deterministically.
DROP TABLE IF EXISTS hubpedia_wiki_audit;
DROP TABLE IF EXISTS hubpedia_wiki_watches;
DROP TABLE IF EXISTS hubpedia_wiki_discussions;
DROP TABLE IF EXISTS hubpedia_wiki_proposals;
DROP TABLE IF EXISTS hubpedia_wiki_articles;
DROP TABLE IF EXISTS hubpedia_wiki_revisions;

CREATE TABLE IF NOT EXISTS hubpedia_wiki_articles (
  article_key TEXT PRIMARY KEY,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('static_seed', 'd1_article', 'encyclopedia_article')),
  source_id TEXT NOT NULL,
  slug TEXT NOT NULL COLLATE NOCASE,
  risk_level TEXT NOT NULL DEFAULT 'normal' CHECK (risk_level IN ('normal', 'high')),
  published_revision_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (source_kind, source_id),
  UNIQUE (source_kind, slug)
);
CREATE INDEX IF NOT EXISTS idx_hubpedia_wiki_articles_slug ON hubpedia_wiki_articles(slug);

CREATE TABLE IF NOT EXISTS hubpedia_wiki_proposals (
  id TEXT PRIMARY KEY,
  article_key TEXT NOT NULL REFERENCES hubpedia_wiki_articles(article_key) ON DELETE CASCADE,
  editor_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  base_revision_id TEXT,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  body_markdown TEXT NOT NULL,
  edit_reason TEXT NOT NULL,
  source_urls_json TEXT NOT NULL CHECK (json_valid(source_urls_json) AND json_type(source_urls_json) = 'array'),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  requires_manual_approval INTEGER NOT NULL DEFAULT 0 CHECK (requires_manual_approval IN (0, 1)),
  reviewer_profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  review_note TEXT,
  reviewed_at TEXT,
  published_revision_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (length(title) BETWEEN 1 AND 240),
  CHECK (length(summary) <= 1000),
  CHECK (length(body_markdown) BETWEEN 1 AND 1000000),
  CHECK (length(edit_reason) BETWEEN 3 AND 2000),
  CHECK ((status = 'pending' AND reviewed_at IS NULL) OR (status <> 'pending' AND reviewed_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_hubpedia_wiki_proposals_article_status ON hubpedia_wiki_proposals(article_key, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hubpedia_wiki_proposals_editor_created ON hubpedia_wiki_proposals(editor_profile_id, created_at DESC);

CREATE TABLE IF NOT EXISTS hubpedia_wiki_revisions (
  id TEXT PRIMARY KEY,
  article_key TEXT NOT NULL REFERENCES hubpedia_wiki_articles(article_key) ON DELETE CASCADE,
  revision_number INTEGER NOT NULL,
  proposal_id TEXT REFERENCES hubpedia_wiki_proposals(id) ON DELETE SET NULL,
  restored_from_revision_id TEXT REFERENCES hubpedia_wiki_revisions(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  body_markdown TEXT NOT NULL,
  edit_reason TEXT NOT NULL,
  source_urls_json TEXT NOT NULL CHECK (json_valid(source_urls_json) AND json_type(source_urls_json) = 'array'),
  created_by_profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  CHECK (revision_number > 0),
  UNIQUE (article_key, revision_number)
);
CREATE INDEX IF NOT EXISTS idx_hubpedia_wiki_revisions_article_number ON hubpedia_wiki_revisions(article_key, revision_number DESC);

CREATE TABLE IF NOT EXISTS hubpedia_wiki_discussions (
  id TEXT PRIMARY KEY,
  article_key TEXT NOT NULL REFERENCES hubpedia_wiki_articles(article_key) ON DELETE CASCADE,
  author_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  parent_id TEXT REFERENCES hubpedia_wiki_discussions(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  CHECK (length(body) BETWEEN 1 AND 10000)
);
CREATE INDEX IF NOT EXISTS idx_hubpedia_wiki_discussions_article_created ON hubpedia_wiki_discussions(article_key, created_at);

CREATE TABLE IF NOT EXISTS hubpedia_wiki_watches (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  article_key TEXT NOT NULL REFERENCES hubpedia_wiki_articles(article_key) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (profile_id, article_key)
);

-- Immutable event records support rolling per-profile limits and abuse review.
CREATE TABLE IF NOT EXISTS hubpedia_wiki_activity_events (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  article_key TEXT REFERENCES hubpedia_wiki_articles(article_key) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('proposal', 'discussion', 'rejected_proposal')),
  client_ip_hash TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hubpedia_wiki_activity_profile_type_created ON hubpedia_wiki_activity_events(profile_id, event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hubpedia_wiki_activity_ip_type_created ON hubpedia_wiki_activity_events(client_ip_hash, event_type, created_at DESC);
