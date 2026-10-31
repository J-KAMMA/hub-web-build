-- 左の列の「自分のもの」(2026-10-29). Pins put one of the viewer's own library rows (a followed
-- tag, a joined community, a playlist, a game ...) at the top of that section's list in the
-- directory column. Only the pin is stored: item_key is "<kind>:<id>" and the row itself is always
-- read from its own table, so an unfollowed tag or deleted playlist simply drops out. Private to the
-- viewer's Hub profile; never sent to any other service.
CREATE TABLE IF NOT EXISTS hub_library_pins (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  section TEXT NOT NULL CHECK (section IN ('feed', 'articles', 'videos', 'music', 'market', 'games', 'research')),
  item_key TEXT NOT NULL CHECK (length(item_key) BETWEEN 3 AND 200),
  pinned_at TEXT NOT NULL,
  PRIMARY KEY (profile_id, section, item_key)
);

-- Research projects a viewer follows. Only public projects are listed back to the viewer.
CREATE TABLE IF NOT EXISTS hub_research_project_follows (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (profile_id, project_id)
);
CREATE INDEX IF NOT EXISTS idx_hub_research_project_follows_recent
  ON hub_research_project_follows(profile_id, created_at DESC);
