-- 人が書いた記事の保管。
--
-- Hubが持つのは「無料で公開された記事」だけとする。限定本文と閲覧条件は
-- Vaultが所有し、購入・返金はCommerceまたは外部販売者が所有するという
-- 既存の境界を崩さないため、保護本文をこの表へ入れない。したがって
-- access 列は置かない。ここに行があること自体が「無料公開」を意味する。
--
-- 成人区分は記事の属性であって別の置き場ではない。audience='adult' の行は
-- 同じ記事のまま /adult 側の一覧へ投影し、成人表示が無効な画面へは
-- 題名・要約・画像を出さない。

CREATE TABLE IF NOT EXISTS hub_user_articles (
  id TEXT PRIMARY KEY,
  author_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  tags_json TEXT NOT NULL DEFAULT '[]',
  thumbnail_url TEXT,
  audience TEXT NOT NULL DEFAULT 'general',
  status TEXT NOT NULL DEFAULT 'published',
  client_request_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  moderated_at TEXT,
  moderation_reason TEXT,
  CHECK (audience IN ('general','adult')),
  CHECK (status IN ('published','withdrawn')),
  CHECK (length(title) BETWEEN 1 AND 120),
  CHECK (length(summary) <= 400),
  CHECK (length(body) BETWEEN 1 AND 100000),
  CHECK (length(tags_json) <= 400),
  -- 画像の取得先はhttpsだけにする。httpとdata:はSSRFと混在content の入口になる。
  CHECK (thumbnail_url IS NULL OR thumbnail_url LIKE 'https://%')
);

CREATE INDEX IF NOT EXISTS idx_hub_user_articles_published
  ON hub_user_articles(audience, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_hub_user_articles_author
  ON hub_user_articles(author_profile_id, created_at DESC);

-- 同じ下書きを二度押しても記事は1本。著者ごとに冪等キーを一意にする。
CREATE UNIQUE INDEX IF NOT EXISTS hub_user_articles_client_request_unique
  ON hub_user_articles(author_profile_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

-- 著者と発行時刻は後から書き換えない。取り下げと訂正は status と
-- updated_at で表し、別人の記事へ挿し替えられる経路を作らない。
CREATE TRIGGER IF NOT EXISTS HubUserArticleOriginImmutable
BEFORE UPDATE ON hub_user_articles
WHEN NEW.author_profile_id IS NOT OLD.author_profile_id
  OR NEW.created_at IS NOT OLD.created_at
  OR NEW.client_request_id IS NOT OLD.client_request_id
BEGIN
  SELECT RAISE(ABORT,'hub_user_article_origin_immutable');
END;

-- 記事の公開は投稿より重い。専用の窓を持たせ、社会投稿の枠を食わせない。
CREATE TABLE IF NOT EXISTS hub_user_article_rate_limit_buckets (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  window_started_at TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 1,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (profile_id, window_started_at),
  CHECK (request_count > 0)
);

CREATE INDEX IF NOT EXISTS idx_hub_user_article_rate_limit_expires
  ON hub_user_article_rate_limit_buckets(expires_at);
