CREATE TABLE IF NOT EXISTS hubpedia_categories (
  id TEXT PRIMARY KEY,
  parent_id TEXT,
  canonical_key TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK (state IN ('candidate','visible','established','retired','merged')),
  article_count INTEGER NOT NULL DEFAULT 0 CHECK (article_count >= 0),
  dynamic_depth INTEGER NOT NULL DEFAULT 0 CHECK (dynamic_depth BETWEEN 0 AND 8),
  requires_ai_review INTEGER NOT NULL DEFAULT 0 CHECK (requires_ai_review IN (0,1)),
  merged_into_id TEXT,
  promoted_at TEXT,
  demoted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS hubpedia_categories_parent_idx
  ON hubpedia_categories(parent_id, state, article_count DESC);

CREATE TABLE IF NOT EXISTS hubpedia_category_translations (
  category_id TEXT NOT NULL REFERENCES hubpedia_categories(id) ON DELETE CASCADE,
  locale TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (category_id, locale)
);

CREATE TABLE IF NOT EXISTS hubpedia_category_aliases (
  category_id TEXT NOT NULL REFERENCES hubpedia_categories(id) ON DELETE CASCADE,
  locale TEXT NOT NULL,
  alias TEXT NOT NULL,
  normalized_alias TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (category_id, locale, normalized_alias)
);
CREATE INDEX IF NOT EXISTS hubpedia_category_alias_lookup_idx
  ON hubpedia_category_aliases(locale, normalized_alias);

CREATE TABLE IF NOT EXISTS hubpedia_article_categories (
  article_slug TEXT NOT NULL,
  category_id TEXT NOT NULL REFERENCES hubpedia_categories(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('primary','secondary')),
  confidence REAL NOT NULL DEFAULT 1 CHECK (confidence BETWEEN 0 AND 1),
  assignment_source TEXT NOT NULL CHECK (assignment_source IN ('rule','tag-promotion','ai-review','manual-import')),
  assigned_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (article_slug, category_id)
);
CREATE INDEX IF NOT EXISTS hubpedia_article_categories_category_idx
  ON hubpedia_article_categories(category_id, role, confidence DESC);

CREATE TABLE IF NOT EXISTS hubpedia_category_audit_log (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('created','promoted','demoted','renamed','reparented','merged','retired','membership-updated')),
  before_json TEXT,
  after_json TEXT,
  reason TEXT NOT NULL,
  actor_type TEXT NOT NULL DEFAULT 'system' CHECK (actor_type IN ('system','ai','import')),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS hubpedia_category_audit_category_idx
  ON hubpedia_category_audit_log(category_id, created_at DESC);
