PRAGMA foreign_keys = ON;

-- Saves and playlists are Hub-profile-local organization. They do not store
-- provider accounts, video bodies, or cross-service identifiers.
CREATE TABLE IF NOT EXISTS external_video_saves (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL REFERENCES external_videos(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (profile_id, video_id)
);

CREATE INDEX IF NOT EXISTS idx_external_video_saves_ranking
  ON external_video_saves(video_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_external_video_saves_profile
  ON external_video_saves(profile_id, created_at DESC);

CREATE TABLE IF NOT EXISTS external_video_playlists (
  id TEXT PRIMARY KEY,
  owner_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (length(title) BETWEEN 1 AND 80),
  CHECK (length(description) <= 500)
);

CREATE INDEX IF NOT EXISTS idx_external_video_playlists_owner
  ON external_video_playlists(owner_profile_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS external_video_playlist_items (
  playlist_id TEXT NOT NULL REFERENCES external_video_playlists(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL REFERENCES external_videos(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  PRIMARY KEY (playlist_id, video_id),
  CHECK (position >= 0)
);

CREATE INDEX IF NOT EXISTS idx_external_video_playlist_items_order
  ON external_video_playlist_items(playlist_id, position, created_at);
