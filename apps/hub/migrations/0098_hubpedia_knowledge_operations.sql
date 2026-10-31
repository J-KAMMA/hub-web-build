ALTER TABLE hubpedia_mcp_usage_daily ADD COLUMN error_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE hubpedia_mcp_usage_daily ADD COLUMN conditional_hit_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE hubpedia_mcp_usage_daily ADD COLUMN response_milliseconds INTEGER NOT NULL DEFAULT 0;
ALTER TABLE hubpedia_mcp_usage_daily ADD COLUMN estimated_web_fetches_avoided INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS hubpedia_knowledge_migrations (
  article_slug TEXT PRIMARY KEY,
  source_revision_key TEXT NOT NULL,
  destination_revision_id TEXT,
  status TEXT NOT NULL CHECK(status IN ('queued','migrated','failed','superseded')),
  error_category TEXT,
  migrated_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS hubpedia_knowledge_migrations_status_idx ON hubpedia_knowledge_migrations(status,updated_at);

CREATE TABLE IF NOT EXISTS hubpedia_freshness_events (
  id TEXT PRIMARY KEY,
  article_slug TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type IN ('source-changed','verification-due','verified','invalidated')),
  source_url TEXT,
  source_content_hash TEXT,
  detail TEXT,
  detected_at TEXT NOT NULL,
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS hubpedia_freshness_events_open_idx ON hubpedia_freshness_events(event_type,resolved_at,detected_at);
