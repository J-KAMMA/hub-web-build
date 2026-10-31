PRAGMA foreign_keys = ON;

-- Hub-local favorites are separate from named playlists. Item IDs may point
-- to public Hub catalog works or namespaced public Music tracks.
CREATE TABLE IF NOT EXISTS music_favorites (
  owner_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  music_item_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (owner_profile_id, music_item_id),
  CHECK (length(music_item_id) BETWEEN 1 AND 128)
);

CREATE INDEX IF NOT EXISTS idx_music_favorites_owner
  ON music_favorites(owner_profile_id, created_at DESC);

-- Preserve the old combined heart/playlist behavior as initial favorites.
INSERT OR IGNORE INTO music_favorites (owner_profile_id, music_item_id, created_at)
SELECT p.owner_profile_id, i.music_work_id, i.created_at
FROM music_playlist_items i
JOIN music_playlists p ON p.id = i.playlist_id;
