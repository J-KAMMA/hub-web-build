-- 利用者記事のマガジン（キュレーターが、誰の記事でも公開中の記事を集める）。
--
-- シリーズ（0250）は著者1人が自分の記事だけを束ねる。マガジンは別物で、所有者は
-- owner_profile_id の1人、入れる記事は他人のものでもよい。1つの記事は複数のマガジンに入れる。
-- 公開状態・成人区分・モデレーション・鍵付きかどうかは記事側が持つ。この表では持たず、
-- 読む側が hub_user_articles と結合して判定する。記事が消えれば束ねも消える（CASCADE）。
-- 追加の可否（ブロック関係・著者の受け入れ設定・上限）はアプリ側
-- （d1-user-article-magazines.ts）が守る。

CREATE TABLE IF NOT EXISTS hub_user_article_magazines (
  id TEXT PRIMARY KEY,
  owner_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (length(title) BETWEEN 1 AND 100),
  CHECK (length(description) <= 400)
);

CREATE INDEX IF NOT EXISTS idx_hub_user_article_magazines_owner
  ON hub_user_article_magazines(owner_profile_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS hub_user_article_magazine_items (
  magazine_id TEXT NOT NULL REFERENCES hub_user_article_magazines(id) ON DELETE CASCADE,
  article_id TEXT NOT NULL REFERENCES hub_user_articles(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  added_at TEXT NOT NULL,
  PRIMARY KEY (magazine_id, article_id),
  CHECK (position >= 0)
);

CREATE INDEX IF NOT EXISTS idx_hub_user_article_magazine_items_order
  ON hub_user_article_magazine_items(magazine_id, position, article_id);
CREATE INDEX IF NOT EXISTS idx_hub_user_article_magazine_items_article
  ON hub_user_article_magazine_items(article_id);

-- 書き手ごとの設定。行が無ければ「マガジンへの追加を受け入れる」。
CREATE TABLE IF NOT EXISTS hub_user_article_magazine_settings (
  profile_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  allow_adding INTEGER NOT NULL DEFAULT 1 CHECK (allow_adding IN (0, 1)),
  updated_at TEXT NOT NULL
);
