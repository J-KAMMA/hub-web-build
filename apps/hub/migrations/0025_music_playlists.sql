PRAGMA foreign_keys = ON;

-- Hub-profile-local organization for public music catalog works. This stores
-- no Music session, provider account, audio body, or cross-service identity.
CREATE TABLE IF NOT EXISTS music_playlists (
  id TEXT PRIMARY KEY,
  owner_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (length(title) BETWEEN 1 AND 80),
  CHECK (length(description) <= 500)
);

CREATE INDEX IF NOT EXISTS idx_music_playlists_owner
  ON music_playlists(owner_profile_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS music_playlist_items (
  playlist_id TEXT NOT NULL REFERENCES music_playlists(id) ON DELETE CASCADE,
  music_work_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (playlist_id, music_work_id),
  CHECK (position >= 0)
);

CREATE INDEX IF NOT EXISTS idx_music_playlist_items_order
  ON music_playlist_items(playlist_id, position, created_at);
