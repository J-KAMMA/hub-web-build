PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS community_custom_roles (
  id TEXT PRIMARY KEY,
  community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 40),
  position INTEGER NOT NULL DEFAULT 0,
  can_manage_channels INTEGER NOT NULL DEFAULT 0 CHECK(can_manage_channels IN (0,1)),
  can_manage_posts INTEGER NOT NULL DEFAULT 0 CHECK(can_manage_posts IN (0,1)),
  can_manage_members INTEGER NOT NULL DEFAULT 0 CHECK(can_manage_members IN (0,1)),
  can_manage_guides INTEGER NOT NULL DEFAULT 0 CHECK(can_manage_guides IN (0,1)),
  created_at TEXT NOT NULL,
  UNIQUE(community_id, name)
);

CREATE TABLE IF NOT EXISTS community_member_custom_roles (
  community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role_id TEXT NOT NULL REFERENCES community_custom_roles(id) ON DELETE CASCADE,
  assigned_at TEXT NOT NULL,
  assigned_by_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  PRIMARY KEY(community_id, profile_id, role_id)
);

CREATE TABLE IF NOT EXISTS community_channel_permissions (
  channel_id TEXT NOT NULL REFERENCES community_channels(id) ON DELETE CASCADE,
  role_id TEXT NOT NULL REFERENCES community_custom_roles(id) ON DELETE CASCADE,
  can_view INTEGER NOT NULL DEFAULT 1 CHECK(can_view IN (0,1)),
  can_post INTEGER NOT NULL DEFAULT 1 CHECK(can_post IN (0,1)),
  can_manage INTEGER NOT NULL DEFAULT 0 CHECK(can_manage IN (0,1)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(channel_id, role_id)
);

CREATE TABLE IF NOT EXISTS community_invites (
  id TEXT PRIMARY KEY,
  community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL DEFAULT '' CHECK(length(label) <= 80),
  max_uses INTEGER CHECK(max_uses IS NULL OR max_uses > 0),
  use_count INTEGER NOT NULL DEFAULT 0 CHECK(use_count >= 0),
  expires_at TEXT,
  revoked_at TEXT,
  created_by_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS community_rules (
  id TEXT PRIMARY KEY,
  community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 80),
  body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 1000),
  position INTEGER NOT NULL DEFAULT 0,
  required INTEGER NOT NULL DEFAULT 1 CHECK(required IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS community_member_actions (
  id TEXT PRIMARY KEY,
  community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  target_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  actor_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK(action IN ('warn','timeout','remove_timeout')),
  reason TEXT NOT NULL DEFAULT '' CHECK(length(reason) <= 1000),
  expires_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS community_verification_requests (
  community_id TEXT PRIMARY KEY REFERENCES communities(id) ON DELETE CASCADE,
  requested_by_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL CHECK(length(reason) BETWEEN 20 AND 1000),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS community_daily_metrics (
  community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  metric_day TEXT NOT NULL,
  active_members INTEGER NOT NULL DEFAULT 0,
  joins INTEGER NOT NULL DEFAULT 0,
  leaves INTEGER NOT NULL DEFAULT 0,
  posts INTEGER NOT NULL DEFAULT 0,
  reports INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(community_id, metric_day)
);

ALTER TABLE communities ADD COLUMN lifecycle_status TEXT NOT NULL DEFAULT 'active'
  CHECK(lifecycle_status IN ('active','closed'));
ALTER TABLE communities ADD COLUMN verification_status TEXT NOT NULL DEFAULT 'unverified'
  CHECK(verification_status IN ('unverified','pending','verified','rejected'));
ALTER TABLE community_message_reports ADD COLUMN resolved_by_profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_community_invites_active ON community_invites(community_id, revoked_at, expires_at);
CREATE INDEX IF NOT EXISTS idx_community_actions_target ON community_member_actions(community_id, target_profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_community_metrics_day ON community_daily_metrics(community_id, metric_day DESC);
