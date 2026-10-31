PRAGMA foreign_keys = ON;

ALTER TABLE communities ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public'
  CHECK (visibility IN ('public', 'approval', 'private'));

CREATE TABLE IF NOT EXISTS community_notification_preferences (
  community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  mentions INTEGER NOT NULL DEFAULT 1 CHECK (mentions IN (0, 1)),
  replies INTEGER NOT NULL DEFAULT 1 CHECK (replies IN (0, 1)),
  guide_updates INTEGER NOT NULL DEFAULT 1 CHECK (guide_updates IN (0, 1)),
  governance INTEGER NOT NULL DEFAULT 1 CHECK (governance IN (0, 1)),
  membership INTEGER NOT NULL DEFAULT 1 CHECK (membership IN (0, 1)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (community_id, profile_id)
);

CREATE TABLE IF NOT EXISTS community_membership_requests (
  community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  resolved_by_profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  PRIMARY KEY (community_id, profile_id)
);

CREATE TABLE IF NOT EXISTS community_audit_log (
  id TEXT PRIMARY KEY,
  community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  actor_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  target_profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_community_audit_log_timeline
  ON community_audit_log(community_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_community_membership_requests_queue
  ON community_membership_requests(community_id, status, created_at);
