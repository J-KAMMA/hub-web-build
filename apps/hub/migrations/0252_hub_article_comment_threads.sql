-- 記事コメントの返信（1段）、コメントへのいいね、書き手によるピン留め。
--
-- 返信は parent_id を持つ行。返信への返信は経路側で最上位コメントへ付け替えるので、
-- 深さは常に1段。parent_id は NULL 許容の列追加だけにして、CHECK のある表を作り直さない。
-- 外部キーは付けない（列追加で付けられないため）。親の存在は書き込み時に確かめ、
-- 記事ごと消えるときは article_id 側の CASCADE で返信も消える。
-- 削除済みの親は行が残るので、返信は「削除されたコメント」の下に残せる。
--
-- いいねは comment_id + profile_id で1人1回。数は誰にでも見せる。
-- ピン留めは設定の行に1件だけ持つ（記事の書き手本人だけが設定する）。

ALTER TABLE hub_user_article_comments ADD COLUMN parent_id TEXT;

CREATE INDEX IF NOT EXISTS idx_hub_user_article_comments_thread
  ON hub_user_article_comments(article_id, parent_id, created_at, id);

CREATE TABLE IF NOT EXISTS hub_user_article_comment_likes (
  comment_id TEXT NOT NULL REFERENCES hub_user_article_comments(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (comment_id, profile_id)
);

CREATE INDEX IF NOT EXISTS idx_hub_user_article_comment_likes_profile
  ON hub_user_article_comment_likes(profile_id, comment_id);

ALTER TABLE hub_user_article_comment_settings ADD COLUMN pinned_comment_id TEXT;
