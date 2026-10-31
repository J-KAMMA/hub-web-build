CREATE TABLE IF NOT EXISTS hub_developer_services (
  id TEXT PRIMARY KEY,
  owner_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  service_name TEXT NOT NULL COLLATE NOCASE,
  display_name TEXT NOT NULL,
  description TEXT NOT NULL,
  homepage_url TEXT NOT NULL,
  privacy_url TEXT NOT NULL,
  terms_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  review_note TEXT NOT NULL DEFAULT '',
  submitted_at TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (length(service_name) BETWEEN 5 AND 128),
  CHECK (length(display_name) BETWEEN 1 AND 100),
  CHECK (length(description) BETWEEN 20 AND 2000),
  CHECK (status IN ('draft','submitted','changes_requested','approved','suspended','revoked')),
  UNIQUE (service_name)
);
CREATE INDEX IF NOT EXISTS idx_hub_developer_services_owner
  ON hub_developer_services(owner_profile_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_hub_developer_services_review
  ON hub_developer_services(status, submitted_at);

CREATE TABLE IF NOT EXISTS hub_developer_capabilities (
  id TEXT PRIMARY KEY,
  service_id TEXT NOT NULL REFERENCES hub_developer_services(id) ON DELETE CASCADE,
  capability_name TEXT NOT NULL COLLATE NOCASE,
  description TEXT NOT NULL,
  endpoint_url TEXT NOT NULL,
  http_method TEXT NOT NULL,
  input_schema_url TEXT NOT NULL,
  output_schema_url TEXT NOT NULL,
  permissions_json TEXT NOT NULL,
  cost_mode TEXT NOT NULL,
  human_approval TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (http_method IN ('GET','POST')),
  CHECK (cost_mode IN ('free','fixed','metered','external')),
  CHECK (human_approval IN ('not_required','required')),
  UNIQUE (capability_name)
);
CREATE INDEX IF NOT EXISTS idx_hub_developer_capabilities_service
  ON hub_developer_capabilities(service_id, capability_name);
