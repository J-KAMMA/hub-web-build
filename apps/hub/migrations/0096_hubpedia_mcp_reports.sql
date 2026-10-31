CREATE TABLE IF NOT EXISTS hubpedia_mcp_reports (
  id TEXT PRIMARY KEY,
  report_type TEXT NOT NULL CHECK (report_type IN ('missing-topic','outdated-claim')),
  topic TEXT,
  article_slug TEXT,
  section_key TEXT,
  detail TEXT NOT NULL,
  evidence_url TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','reviewing','accepted','rejected','completed')),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS hubpedia_mcp_reports_status_idx ON hubpedia_mcp_reports(status, created_at);

CREATE TABLE IF NOT EXISTS hubpedia_mcp_usage_daily (
  usage_date TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  cache_hit_count INTEGER NOT NULL DEFAULT 0,
  response_characters INTEGER NOT NULL DEFAULT 0,
  estimated_tokens_saved INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (usage_date, tool_name)
);
