CREATE TABLE IF NOT EXISTS hubpedia_operation_control (
  control_key TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  reason TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO hubpedia_operation_control(control_key, enabled, updated_at)
VALUES ('automation', 1, datetime('now'));

CREATE TABLE IF NOT EXISTS hubpedia_repair_queue (
  id TEXT PRIMARY KEY,
  article_slug TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','completed','failed','cancelled')),
  assessment TEXT NOT NULL DEFAULT '{}',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  available_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(article_slug, reason_code, status)
);
CREATE INDEX IF NOT EXISTS hubpedia_repair_queue_ready_idx ON hubpedia_repair_queue(status, priority DESC, available_at);

CREATE TABLE IF NOT EXISTS hubpedia_source_license_registry (
  source_host TEXT PRIMARY KEY,
  license_name TEXT,
  license_url TEXT,
  reuse_status TEXT NOT NULL CHECK (reuse_status IN ('allowed','attribution-required','review-required','blocked')),
  attribution_template TEXT,
  reviewed_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hubpedia_search_events (
  id TEXT PRIMARY KEY,
  query_hash TEXT NOT NULL,
  normalized_query TEXT NOT NULL,
  result_count INTEGER NOT NULL,
  clicked_slug TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('shown','clicked','abandoned')),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS hubpedia_search_events_query_idx ON hubpedia_search_events(query_hash, created_at DESC);

CREATE TABLE IF NOT EXISTS hubpedia_article_audits (
  id TEXT PRIMARY KEY,
  article_slug TEXT NOT NULL,
  revision_key TEXT NOT NULL,
  quality_score INTEGER NOT NULL,
  publishable INTEGER NOT NULL CHECK (publishable IN (0, 1)),
  blockers TEXT NOT NULL DEFAULT '[]',
  changed_blocks TEXT NOT NULL DEFAULT '[]',
  change_reason TEXT,
  checked_at TEXT NOT NULL,
  UNIQUE(article_slug, revision_key)
);
CREATE INDEX IF NOT EXISTS hubpedia_article_audits_slug_idx ON hubpedia_article_audits(article_slug, checked_at DESC);
