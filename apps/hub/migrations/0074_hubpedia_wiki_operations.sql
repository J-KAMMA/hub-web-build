ALTER TABLE hubpedia_wiki_proposals ADD COLUMN conflict_status TEXT NOT NULL DEFAULT 'clear';
ALTER TABLE hubpedia_wiki_proposals ADD COLUMN ai_review_status TEXT NOT NULL DEFAULT 'not_requested';
ALTER TABLE hubpedia_wiki_proposals ADD COLUMN ai_review_result TEXT NOT NULL DEFAULT '{}';
ALTER TABLE hubpedia_wiki_proposals ADD COLUMN withdrawn_at TEXT;

ALTER TABLE hubpedia_wiki_articles ADD COLUMN page_kind TEXT NOT NULL DEFAULT 'article';
ALTER TABLE hubpedia_wiki_articles ADD COLUMN redirect_to_slug TEXT;
ALTER TABLE hubpedia_wiki_articles ADD COLUMN protected_until TEXT;
ALTER TABLE hubpedia_wiki_articles ADD COLUMN protection_reason TEXT;

CREATE TABLE IF NOT EXISTS hubpedia_wiki_editor_trust (
  profile_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  level TEXT NOT NULL DEFAULT 'newcomer', approved_edits INTEGER NOT NULL DEFAULT 0,
  rejected_edits INTEGER NOT NULL DEFAULT 0, blocked_until TEXT, updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hubpedia_wiki_aliases (
  alias TEXT PRIMARY KEY, article_slug TEXT NOT NULL, alias_type TEXT NOT NULL DEFAULT 'alias',
  locale TEXT NOT NULL DEFAULT 'ja', reading TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS hubpedia_wiki_aliases_article_idx ON hubpedia_wiki_aliases(article_slug);

CREATE TABLE IF NOT EXISTS hubpedia_wiki_discussion_reports (
  id TEXT PRIMARY KEY, discussion_id TEXT NOT NULL REFERENCES hubpedia_wiki_discussions(id) ON DELETE CASCADE,
  reporter_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL,
  UNIQUE(discussion_id, reporter_profile_id)
);

CREATE TABLE IF NOT EXISTS hubpedia_wiki_article_views (
  article_slug TEXT NOT NULL, view_date TEXT NOT NULL, view_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(article_slug, view_date)
);

CREATE TABLE IF NOT EXISTS hubpedia_wiki_source_health (
  article_slug TEXT NOT NULL, source_url TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'unchecked',
  http_status INTEGER, checked_at TEXT, error_category TEXT,
  PRIMARY KEY(article_slug, source_url)
);

CREATE INDEX IF NOT EXISTS hubpedia_wiki_proposals_conflict_idx
  ON hubpedia_wiki_proposals(status, conflict_status, ai_review_status, created_at);
