PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS profile_external_links (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  url TEXT NOT NULL,
  position INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (profile_id, position),
  CHECK (length(label) BETWEEN 1 AND 40),
  CHECK (length(url) BETWEEN 1 AND 2048),
  CHECK (position BETWEEN 0 AND 2)
);
CREATE INDEX IF NOT EXISTS idx_profile_external_links_profile
  ON profile_external_links(profile_id, position);

ALTER TABLE community_memberships ADD COLUMN profile_visibility TEXT NOT NULL DEFAULT 'private'
  CHECK (profile_visibility IN ('private', 'public'));
CREATE INDEX IF NOT EXISTS idx_community_memberships_profile_visibility
  ON community_memberships(profile_id, profile_visibility, joined_at DESC);

CREATE TABLE IF NOT EXISTS profile_reports (
  id TEXT PRIMARY KEY,
  target_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reporter_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (target_profile_id, reporter_profile_id),
  CHECK (target_profile_id <> reporter_profile_id),
  CHECK (reason IN ('harassment', 'spam', 'impersonation', 'privacy', 'other')),
  CHECK (length(details) <= 500),
  CHECK (status IN ('open', 'reviewed', 'closed'))
);
CREATE INDEX IF NOT EXISTS idx_profile_reports_status_created
  ON profile_reports(status, created_at DESC);
