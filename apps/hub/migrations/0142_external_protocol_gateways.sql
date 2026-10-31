-- Public-protocol links are Hub-profile scoped and deliberately contain no
-- remote credentials, private messages, account subjects, or signing keys.
CREATE TABLE IF NOT EXISTS hub_external_protocol_links (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  protocol TEXT NOT NULL,
  remote_identifier TEXT NOT NULL,
  direction TEXT NOT NULL DEFAULT 'export',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (protocol IN ('activitypub','atproto')),
  CHECK (direction IN ('export','import','bidirectional')),
  CHECK (status IN ('active','paused','revoked')),
  CHECK (length(remote_identifier) BETWEEN 3 AND 512),
  UNIQUE (profile_id, protocol, remote_identifier)
);
CREATE INDEX IF NOT EXISTS idx_hub_external_protocol_links_profile
  ON hub_external_protocol_links(profile_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS hub_portability_exports (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  format TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed',
  record_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  CHECK (format IN ('hub-portable-v1','activitystreams-v1','atproto-repository-v1')),
  CHECK (status IN ('completed','failed')),
  CHECK (record_count >= 0)
);
CREATE INDEX IF NOT EXISTS idx_hub_portability_exports_profile
  ON hub_portability_exports(profile_id, created_at DESC);
