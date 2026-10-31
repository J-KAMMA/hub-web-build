-- 公開後の記事の編集履歴。
--
-- 編集や取り下げの直前の内容を1行ずつ残す（「変更前」の写し）。現在の内容は
-- hub_user_articles が持つので、履歴は著者の見直しと、荒らし・誤編集の確認に使う。
-- 記事が消えれば履歴も消える。著者のアカウント削除でも連鎖して消える。

CREATE TABLE IF NOT EXISTS hub_user_article_revisions (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL REFERENCES hub_user_articles(id) ON DELETE CASCADE,
  author_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  reason TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  body TEXT NOT NULL,
  tags_json TEXT NOT NULL,
  thumbnail_url TEXT,
  audience TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK (reason IN ('edit','unpublish','republish')),
  CHECK (revision >= 1),
  UNIQUE (article_id, revision)
);

CREATE INDEX IF NOT EXISTS idx_hub_user_article_revisions_article
  ON hub_user_article_revisions(article_id, revision DESC);

CREATE INDEX IF NOT EXISTS idx_hub_user_article_revisions_author
  ON hub_user_article_revisions(author_profile_id, created_at DESC);
