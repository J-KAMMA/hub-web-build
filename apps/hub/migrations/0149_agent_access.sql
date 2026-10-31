-- Hub-local delegated access for MCP and other user-owned agents.
-- Tokens are stored only as hashes and can act only as one Hub profile.
CREATE TABLE IF NOT EXISTS hub_agent_grants (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('codex', 'chatgpt', 'claude', 'local_ai', 'custom')),
  token_hash TEXT NOT NULL UNIQUE,
  scopes TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_hub_agent_grants_profile
  ON hub_agent_grants(profile_id, revoked_at, expires_at);

CREATE TABLE IF NOT EXISTS hub_agent_drafts (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  grant_id TEXT NOT NULL REFERENCES hub_agent_grants(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  destination_type TEXT NOT NULL DEFAULT 'feed'
    CHECK (destination_type IN ('feed', 'reply', 'thread', 'community')),
  destination_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'approved', 'published', 'cancelled')),
  created_at TEXT NOT NULL,
  approved_at TEXT,
  published_at TEXT,
  published_post_id TEXT REFERENCES social_posts(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_hub_agent_drafts_profile
  ON hub_agent_drafts(profile_id, status, created_at);

CREATE TABLE IF NOT EXISTS hub_agent_audit (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  grant_id TEXT REFERENCES hub_agent_grants(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_hub_agent_audit_profile
  ON hub_agent_audit(profile_id, created_at);
