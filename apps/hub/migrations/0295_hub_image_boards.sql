-- 画像ボード (2026-10-29). A Pinterest-like way to keep images found in /v2/search?group=images.
-- Boards are private to the owner's Hub profile unless is_public is set. An item stores only a
-- reference (the public id or URL), the thumbnail URL, the source page URL, the licence line, the
-- title and when it was saved, plus the pixel size so the grid can reserve space. Hub-owned items
-- (hub-post, hub-article, remote) are re-read from their own tables when a board is shown, so an
-- image that is later gated, hidden or removed drops out. No image bytes are stored here.
CREATE TABLE IF NOT EXISTS hub_image_boards (
  id TEXT PRIMARY KEY,
  owner_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  is_public INTEGER NOT NULL DEFAULT 0 CHECK (is_public IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hub_image_boards_owner
  ON hub_image_boards(owner_profile_id, updated_at DESC, id);

CREATE TABLE IF NOT EXISTS hub_image_board_items (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL REFERENCES hub_image_boards(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('hub-post', 'hub-article', 'remote', 'openverse', 'commons')),
  ref TEXT NOT NULL CHECK (length(ref) BETWEEN 1 AND 2048),
  thumbnail_url TEXT NOT NULL CHECK (length(thumbnail_url) BETWEEN 1 AND 2048),
  source_url TEXT NOT NULL CHECK (length(source_url) BETWEEN 1 AND 2048),
  licence TEXT NOT NULL DEFAULT '' CHECK (length(licence) <= 200),
  title TEXT NOT NULL DEFAULT '' CHECK (length(title) <= 300),
  width INTEGER CHECK (width IS NULL OR width BETWEEN 1 AND 20000),
  height INTEGER CHECK (height IS NULL OR height BETWEEN 1 AND 20000),
  saved_at TEXT NOT NULL,
  UNIQUE (board_id, kind, ref)
);
CREATE INDEX IF NOT EXISTS idx_hub_image_board_items_board
  ON hub_image_board_items(board_id, saved_at DESC, id);
