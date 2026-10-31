-- Videos announced by other Hubs (docs/hub-video/PLAN.md 4.3, AGENTS.md video federation).
--
-- A catalog reference only: title, duration, thumbnail URL and the remote watch-page URL. This Hub
-- never fetches, caches, transcodes or proxies the remote video bytes or HLS, so there is no media
-- URL column. A row is created by a Create(Video) from a remote actor this Hub's users follow, is
-- changed only by the same actor, and is removed (removed_at) by Delete or by an Update that no
-- longer passes validation. The row is not an external_videos entry and is never federated again.
CREATE TABLE IF NOT EXISTS remote_hub_videos (
  object_id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  actor_url TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  duration_ms INTEGER,
  watch_url TEXT NOT NULL,
  thumbnail_url TEXT,
  license TEXT NOT NULL DEFAULT 'arr',
  sensitive INTEGER NOT NULL DEFAULT 0,
  published_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  removed_at TEXT,
  CHECK (length(title) BETWEEN 1 AND 240),
  CHECK (length(watch_url) BETWEEN 1 AND 2048),
  CHECK (thumbnail_url IS NULL OR length(thumbnail_url) <= 2048),
  CHECK (duration_ms IS NULL OR duration_ms >= 0),
  CHECK (sensitive IN (0, 1))
);

CREATE INDEX IF NOT EXISTS idx_remote_hub_videos_listed
  ON remote_hub_videos(published_at DESC) WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_remote_hub_videos_profile
  ON remote_hub_videos(profile_id, removed_at);
