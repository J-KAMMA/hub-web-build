ALTER TABLE hubpedia_categories ADD COLUMN namespace TEXT NOT NULL DEFAULT 'general';
ALTER TABLE hubpedia_categories ADD COLUMN category_kind TEXT NOT NULL DEFAULT 'topic'
  CHECK (category_kind IN ('topic','work','character','place','item','organization','event','maintenance'));
ALTER TABLE hubpedia_categories ADD COLUMN concept_article_slug TEXT;
ALTER TABLE hubpedia_categories ADD COLUMN integrity_status TEXT NOT NULL DEFAULT 'unchecked'
  CHECK (integrity_status IN ('unchecked','valid','review-required','invalid'));

ALTER TABLE hubpedia_article_categories ADD COLUMN assignment_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE hubpedia_article_categories ADD COLUMN evidence_reference TEXT;
ALTER TABLE hubpedia_article_categories ADD COLUMN scope_json TEXT NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS hubpedia_category_edges (
  parent_id TEXT NOT NULL REFERENCES hubpedia_categories(id) ON DELETE CASCADE,
  child_id TEXT NOT NULL REFERENCES hubpedia_categories(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL DEFAULT 'subclass'
    CHECK (relation_type IN ('subclass','part-of','work-facet','regional','temporal','application')),
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0,1)),
  confidence REAL NOT NULL DEFAULT 1 CHECK (confidence BETWEEN 0 AND 1),
  reason TEXT NOT NULL,
  evidence_reference TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (parent_id, child_id, relation_type),
  CHECK (parent_id <> child_id)
);
CREATE INDEX IF NOT EXISTS hubpedia_category_edges_child_idx
  ON hubpedia_category_edges(child_id, is_primary DESC, confidence DESC);

CREATE TABLE IF NOT EXISTS hubpedia_category_integrity_findings (
  id TEXT PRIMARY KEY,
  category_id TEXT,
  finding_type TEXT NOT NULL CHECK (finding_type IN (
    'cycle','orphan','duplicate','overlap','parent-smaller-than-child',
    'unhelpful-depth','singleton-visible','semantic-review'
  )),
  severity TEXT NOT NULL CHECK (severity IN ('info','warning','blocker')),
  detail TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','ignored')),
  detected_at TEXT NOT NULL,
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS hubpedia_category_findings_open_idx
  ON hubpedia_category_integrity_findings(status, severity, detected_at DESC);

CREATE TABLE IF NOT EXISTS hubpedia_article_spoiler_scopes (
  article_slug TEXT NOT NULL,
  section_key TEXT NOT NULL,
  work_slug TEXT NOT NULL,
  earliest_installment TEXT,
  original_release_at TEXT,
  disclosure_level TEXT NOT NULL DEFAULT 'major'
    CHECK (disclosure_level IN ('minor','major','ending','identity','death')),
  summary TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (article_slug, section_key)
);

CREATE TABLE IF NOT EXISTS hubpedia_category_refresh_queue (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','completed','failed')),
  priority INTEGER NOT NULL DEFAULT 50 CHECK (priority BETWEEN 0 AND 100),
  requested_at TEXT NOT NULL,
  completed_at TEXT,
  error_category TEXT
);
CREATE INDEX IF NOT EXISTS hubpedia_category_refresh_pending_idx
  ON hubpedia_category_refresh_queue(status, priority DESC, requested_at);

CREATE TABLE IF NOT EXISTS hubpedia_category_comparisons (
  left_category_id TEXT NOT NULL,
  right_category_id TEXT NOT NULL,
  locale TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  comparison_json TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  PRIMARY KEY (left_category_id, right_category_id, locale)
);
