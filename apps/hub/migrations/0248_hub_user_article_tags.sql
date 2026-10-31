-- 利用者記事のタグを正規化する。
--
-- tags_json は本文側の正本のまま残す。この表は「タグから記事を引く」ための索引で、
-- 書き込みは下の3つのトリガーが tags_json から導く。公開・編集のコードは
-- この表を知らなくてよい。
--
-- created_at は記事の発行時刻の複製。発行時刻は HubUserArticleOriginImmutable で
-- 書き換えられないので、複製がずれることはない。(tag, created_at, article_id) の
-- 索引で、OFFSET を使わずタグ頁を keyset で歩ける。
--
-- 公開状態・成人区分・モデレーションは記事の表が持つ。この表では持たず、
-- 読む側が hub_user_articles と結合して判定する。

CREATE TABLE IF NOT EXISTS hub_user_article_tags (
  article_id TEXT NOT NULL REFERENCES hub_user_articles(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (article_id, tag),
  CHECK (length(tag) BETWEEN 1 AND 100)
);

CREATE INDEX IF NOT EXISTS idx_hub_user_article_tags_tag
  ON hub_user_article_tags(tag, created_at DESC, article_id DESC);

-- 既存の記事から埋める。壊れたJSON・文字列以外・空・長すぎるタグは入れない。
INSERT OR IGNORE INTO hub_user_article_tags (article_id, tag, created_at)
SELECT a.id, j.value, a.created_at
FROM hub_user_articles a,
  json_each(CASE WHEN json_valid(a.tags_json) THEN a.tags_json ELSE '[]' END) j
WHERE j.type = 'text' AND length(j.value) BETWEEN 1 AND 100;

CREATE TRIGGER IF NOT EXISTS HubUserArticleTagsAfterInsert
AFTER INSERT ON hub_user_articles
BEGIN
  INSERT OR IGNORE INTO hub_user_article_tags (article_id, tag, created_at)
  SELECT NEW.id, j.value, NEW.created_at
  FROM json_each(CASE WHEN json_valid(NEW.tags_json) THEN NEW.tags_json ELSE '[]' END) j
  WHERE j.type = 'text' AND length(j.value) BETWEEN 1 AND 100;
END;

CREATE TRIGGER IF NOT EXISTS HubUserArticleTagsAfterUpdate
AFTER UPDATE OF tags_json ON hub_user_articles
WHEN NEW.tags_json IS NOT OLD.tags_json
BEGIN
  DELETE FROM hub_user_article_tags WHERE article_id = NEW.id;
  INSERT OR IGNORE INTO hub_user_article_tags (article_id, tag, created_at)
  SELECT NEW.id, j.value, NEW.created_at
  FROM json_each(CASE WHEN json_valid(NEW.tags_json) THEN NEW.tags_json ELSE '[]' END) j
  WHERE j.type = 'text' AND length(j.value) BETWEEN 1 AND 100;
END;
