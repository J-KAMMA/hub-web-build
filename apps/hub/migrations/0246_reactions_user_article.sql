-- 記事（hub_user_articles）へのいいねを reactions に載せる。
-- target_type の CHECK に 'user_article' を足すため、0132 と同じ手順で表を作り直す。
-- 行は id ごとそのまま移し、索引と「いいねだけ」のトリガーも作り直す。

ALTER TABLE reactions RENAME TO reactions_before_user_article;

CREATE TABLE reactions (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK (target_type IN (
    'social_post',
    'thread_post',
    'community_message',
    'vault_content',
    'user_article'
  )),
  CHECK (kind = 'like'),
  UNIQUE (profile_id, target_type, target_id)
);

INSERT INTO reactions (id, target_type, target_id, profile_id, kind, created_at)
SELECT id, target_type, target_id, profile_id, kind, created_at
FROM reactions_before_user_article;

DROP TABLE reactions_before_user_article;

CREATE INDEX idx_reactions_target_kind
  ON reactions(target_type, target_id, kind);

CREATE TRIGGER reactions_like_only_insert
BEFORE INSERT ON reactions
WHEN NEW.kind <> 'like'
BEGIN
  SELECT RAISE(ABORT, 'Only like reactions are supported.');
END;

CREATE TRIGGER reactions_like_only_update
BEFORE UPDATE OF kind ON reactions
WHEN NEW.kind <> 'like'
BEGIN
  SELECT RAISE(ABORT, 'Only like reactions are supported.');
END;
