PRAGMA foreign_keys = ON;

-- Community identity is Hub-local and pseudonymous. It must never contain
-- Identity, commerce, email, phone, wallet-owner, or legal-identity mappings.
CREATE TABLE IF NOT EXISTS communities (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL COLLATE NOCASE UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  owner_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (length(slug) BETWEEN 1 AND 80),
  CHECK (length(name) BETWEEN 1 AND 100),
  CHECK (length(description) <= 2000),
  CHECK (length(category) <= 100)
);

CREATE TABLE IF NOT EXISTS community_memberships (
  community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  joined_at TEXT NOT NULL,
  PRIMARY KEY (community_id, profile_id),
  CHECK (role IN ('owner', 'moderator', 'member'))
);
CREATE INDEX IF NOT EXISTS idx_community_memberships_profile
  ON community_memberships(profile_id, joined_at DESC);
CREATE INDEX IF NOT EXISTS idx_community_memberships_role
  ON community_memberships(community_id, role, joined_at);
