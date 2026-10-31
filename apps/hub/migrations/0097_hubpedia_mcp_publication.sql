CREATE TABLE IF NOT EXISTS hubpedia_mcp_rate_limits (
  usage_date TEXT NOT NULL,
  client_hash TEXT NOT NULL,
  operation_group TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (usage_date, client_hash, operation_group)
);

ALTER TABLE hubpedia_mcp_reports ADD COLUMN duplicate_count INTEGER NOT NULL DEFAULT 1;
ALTER TABLE hubpedia_mcp_reports ADD COLUMN fingerprint TEXT;
CREATE INDEX IF NOT EXISTS hubpedia_mcp_reports_fingerprint_idx ON hubpedia_mcp_reports(fingerprint, status);

CREATE TABLE IF NOT EXISTS hubpedia_mcp_policy_versions (
  version TEXT PRIMARY KEY,
  protocol_version TEXT NOT NULL,
  terms_url TEXT NOT NULL,
  privacy_url TEXT NOT NULL,
  attribution_url TEXT NOT NULL,
  changelog_url TEXT NOT NULL,
  status TEXT NOT NULL,
  effective_at TEXT NOT NULL
);
INSERT OR IGNORE INTO hubpedia_mcp_policy_versions VALUES('v1','2025-06-18','https://hub.jkamma.com/terms','https://hub.jkamma.com/privacy','https://hub.jkamma.com/hubpedia/about','https://hub.jkamma.com/hubpedia/about','active','2026-07-22T00:00:00.000Z');
