-- 利用者記事の日別の合計（閲覧数・いいね数）。書き手本人だけが読む。
--
-- 1行は「記事 × 日本時間の日付」。閲覧1回ごとに views を 1 足す UPSERT だけで更新し、
-- 描画のたびに集計はしない（D1は読んだ行数で課金される）。
-- 閲覧者のID・IP・UA・流入元は持たない。個人の閲覧履歴も作らない。
-- 記事が消えれば一緒に消える。

CREATE TABLE IF NOT EXISTS hub_user_article_daily_stats (
  article_id TEXT NOT NULL REFERENCES hub_user_articles(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  views INTEGER NOT NULL DEFAULT 0,
  likes INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (article_id, day),
  CHECK (day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  CHECK (views >= 0 AND likes >= 0)
);
