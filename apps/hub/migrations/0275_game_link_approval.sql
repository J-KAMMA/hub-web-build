-- A community link grants edit rights over a game (image, update posts, recheck flags) only once the game's
-- owner has approved it. Links that existed before this migration keep working: they are approved as of
-- their original link time.
ALTER TABLE game_guide_community_links ADD COLUMN approved_at TEXT;
UPDATE game_guide_community_links SET approved_at = linked_at WHERE approved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_game_guide_community_links_approved
  ON game_guide_community_links(game_id, approved_at);
