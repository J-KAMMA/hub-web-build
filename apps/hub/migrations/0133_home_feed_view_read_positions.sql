PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS home_feed_view_read_positions (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  view_key TEXT NOT NULL,
  last_seen_item_id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (profile_id, view_key),
  CHECK (
    view_key IN ('recommended', 'popular', 'following')
    OR view_key GLOB 'lists:[A-Za-z0-9_-]*'
  ),
  CHECK (length(view_key) BETWEEN 1 AND 106),
  CHECK (length(last_seen_item_id) BETWEEN 1 AND 120)
);

CREATE INDEX IF NOT EXISTS idx_home_feed_view_read_positions_updated
  ON home_feed_view_read_positions(profile_id, updated_at DESC);
