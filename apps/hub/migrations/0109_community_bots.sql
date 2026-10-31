PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS community_bots (
  id TEXT PRIMARY KEY,
  community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 40),
  kind TEXT NOT NULL CHECK(kind IN ('welcome','moderation','guide_watch','governance','recruitment','digest')),
  channel_id TEXT REFERENCES community_channels(id) ON DELETE SET NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  config_json TEXT NOT NULL DEFAULT '{}',
  permissions_json TEXT NOT NULL DEFAULT '["read","notify"]',
  created_by_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(community_id, name)
);

CREATE TABLE IF NOT EXISTS community_bot_runs (
  id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL REFERENCES community_bots(id) ON DELETE CASCADE,
  community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  trigger_type TEXT NOT NULL CHECK(trigger_type IN ('manual','event','schedule')),
  status TEXT NOT NULL CHECK(status IN ('completed','skipped','failed')),
  matched_count INTEGER NOT NULL DEFAULT 0 CHECK(matched_count >= 0),
  summary TEXT NOT NULL DEFAULT '' CHECK(length(summary) <= 500),
  started_at TEXT NOT NULL,
  completed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_community_bots_enabled
  ON community_bots(community_id, enabled, kind);
CREATE INDEX IF NOT EXISTS idx_community_bot_runs_recent
  ON community_bot_runs(community_id, completed_at DESC);
