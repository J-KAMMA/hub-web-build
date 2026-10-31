-- 利用者記事のシリーズ（著者1人が、自分の記事だけを順番に束ねる）。
--
-- 他人の記事を束ねる集め（マガジン型）は作らない。所有者は owner_profile_id の1人で、
-- 入れられる記事は同じ人が書いた記事だけ。これはアプリ側（d1-user-article-series.ts）が
-- 守る。記事は高々1つのシリーズに入る（article_id が主キー）。
-- 公開状態・成人区分・モデレーションは記事の表が持つ。この表では持たず、
-- 読む側が hub_user_articles と結合して判定する。

CREATE TABLE IF NOT EXISTS hub_user_article_series (
  id TEXT PRIMARY KEY,
  owner_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (length(title) BETWEEN 1 AND 100),
  CHECK (length(description) <= 400)
);

CREATE INDEX IF NOT EXISTS idx_hub_user_article_series_owner
  ON hub_user_article_series(owner_profile_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS hub_user_article_series_items (
  article_id TEXT PRIMARY KEY REFERENCES hub_user_articles(id) ON DELETE CASCADE,
  series_id TEXT NOT NULL REFERENCES hub_user_article_series(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  added_at TEXT NOT NULL,
  CHECK (position >= 0)
);

CREATE INDEX IF NOT EXISTS idx_hub_user_article_series_items_series
  ON hub_user_article_series_items(series_id, position, article_id);
