-- Counting the tags meant walking every work and every signal it carries:
-- 16,394 rows read to draw one rail, on every visit to /music, growing with
-- the catalogue. The answer is the same for everyone and changes only when a
-- work does, so it is kept here and read in tens of rows instead.
CREATE TABLE IF NOT EXISTS music_tag_facets (
  tag TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  count INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_music_tag_facets_kind_count
  ON music_tag_facets (kind, count DESC);
