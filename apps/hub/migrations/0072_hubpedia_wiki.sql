CREATE TABLE IF NOT EXISTS hubpedia_wiki_revisions (
  id TEXT PRIMARY KEY, article_slug TEXT NOT NULL, revision_number INTEGER NOT NULL,
  title TEXT NOT NULL, summary TEXT, body_markdown TEXT NOT NULL, edit_summary TEXT NOT NULL,
  created_by_profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  source_proposal_id TEXT, restored_from_revision_id TEXT, created_at TEXT NOT NULL,
  UNIQUE(article_slug, revision_number)
);
CREATE INDEX IF NOT EXISTS hubpedia_wiki_revisions_article_idx ON hubpedia_wiki_revisions(article_slug, revision_number DESC);

CREATE TABLE IF NOT EXISTS hubpedia_wiki_articles (
  slug TEXT PRIMARY KEY, current_revision_id TEXT REFERENCES hubpedia_wiki_revisions(id) ON DELETE SET NULL,
  revision_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hubpedia_wiki_proposals (
  id TEXT PRIMARY KEY, article_slug TEXT NOT NULL, base_revision_key TEXT NOT NULL,
  title TEXT NOT NULL, summary TEXT, body_markdown TEXT NOT NULL, edit_summary TEXT NOT NULL,
  sources TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','approved','rejected','withdrawn')),
  submitted_by_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reviewed_by_profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  review_note TEXT, created_at TEXT NOT NULL, reviewed_at TEXT
);
CREATE INDEX IF NOT EXISTS hubpedia_wiki_proposals_status_idx ON hubpedia_wiki_proposals(status, created_at DESC);
CREATE INDEX IF NOT EXISTS hubpedia_wiki_proposals_article_idx ON hubpedia_wiki_proposals(article_slug, created_at DESC);

CREATE TABLE IF NOT EXISTS hubpedia_wiki_discussions (
  id TEXT PRIMARY KEY, article_slug TEXT NOT NULL,
  parent_id TEXT REFERENCES hubpedia_wiki_discussions(id) ON DELETE CASCADE,
  body TEXT NOT NULL, created_by_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'visible' CHECK(status IN ('visible','hidden')),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS hubpedia_wiki_discussions_article_idx ON hubpedia_wiki_discussions(article_slug, created_at);

CREATE TABLE IF NOT EXISTS hubpedia_wiki_watches (
  article_slug TEXT NOT NULL, profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL, PRIMARY KEY(article_slug, profile_id)
);

CREATE TABLE IF NOT EXISTS hubpedia_wiki_audit (
  id TEXT PRIMARY KEY, article_slug TEXT NOT NULL,
  actor_profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  action TEXT NOT NULL, target_id TEXT, detail TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS hubpedia_wiki_audit_article_idx ON hubpedia_wiki_audit(article_slug, created_at DESC);
