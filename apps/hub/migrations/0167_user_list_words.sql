ALTER TABLE user_lists
  ADD COLUMN kind TEXT NOT NULL DEFAULT 'members'
  CHECK (kind IN ('members', 'words'));

CREATE TABLE IF NOT EXISTS list_words (
  list_id TEXT NOT NULL REFERENCES user_lists(id) ON DELETE CASCADE,
  word TEXT NOT NULL,
  normalized_word TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  added_at TEXT NOT NULL,
  PRIMARY KEY (list_id, normalized_word),
  CHECK (length(word) BETWEEN 1 AND 40),
  CHECK (length(normalized_word) BETWEEN 1 AND 40)
);

CREATE INDEX IF NOT EXISTS idx_list_words_list_position
  ON list_words(list_id, position, added_at);
