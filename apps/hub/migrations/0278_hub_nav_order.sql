-- 登録 (2026-10-27). The viewer's own order of the registered rows (own lists, followed threads,
-- joined communities) in the v2 timeline column. Only the order is stored. The rows themselves are
-- always read from user_lists, thread_tracking and community_memberships, so an unfollowed thread or
-- a left community simply drops out. Read, written and exported only by the viewer's own profile.
CREATE TABLE IF NOT EXISTS hub_nav_order (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL CHECK (item_type IN ('list', 'thread', 'community')),
  item_id TEXT NOT NULL CHECK (length(item_id) BETWEEN 1 AND 200),
  position INTEGER NOT NULL CHECK (position >= 0),
  PRIMARY KEY (profile_id, item_type, item_id)
);
