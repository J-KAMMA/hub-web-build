-- 記事の下書き（サーバー側）。
--
-- 下書きは公開記事の表（hub_user_articles）へ混ぜず、別表に置く。公開記事の
-- CHECK（題・本文が空でない、status は published/withdrawn だけ）を作り直さずに
-- 済み、未公開の文章が一覧・検索・推薦・連合へ出る経路も最初から無い。
--
-- id は公開時にそのまま記事の id になり、公開操作の冪等キー（client_request_id）にも
-- なる。下書きに付けた画像は post_id にこの id を持つので、公開後も画像が切れない。
--
-- publish_at は予約公開の時刻（UTCのISO）。status='scheduled' の行だけを
-- 定期処理が拾う。閲覧条件（トークンゲート）は公開の瞬間に付けるため、
-- access_gate_id に選択を保持する。
--
-- 利用者の未公開の文章なので、データの書き出しとアカウント削除の対象に入る。
-- profiles への ON DELETE CASCADE が削除側の拠り所。

CREATE TABLE IF NOT EXISTS hub_user_article_drafts (
  id TEXT PRIMARY KEY,
  author_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  tags_json TEXT NOT NULL DEFAULT '[]',
  thumbnail_url TEXT,
  cover_image_id TEXT,
  audience TEXT NOT NULL DEFAULT 'general',
  access_gate_id TEXT,
  publish_at TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  schedule_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (audience IN ('general','adult')),
  CHECK (status IN ('draft','scheduled')),
  CHECK (length(title) <= 120),
  CHECK (length(summary) <= 400),
  CHECK (length(body) <= 100000),
  CHECK (length(tags_json) <= 400),
  CHECK (thumbnail_url IS NULL OR thumbnail_url LIKE 'https://%'),
  -- 予約中の行は時刻を必ず持つ。
  CHECK (status <> 'scheduled' OR publish_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_hub_user_article_drafts_author
  ON hub_user_article_drafts(author_profile_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_hub_user_article_drafts_due
  ON hub_user_article_drafts(publish_at)
  WHERE status = 'scheduled';

-- 著者は後から付け替えない。
CREATE TRIGGER IF NOT EXISTS HubUserArticleDraftAuthorImmutable
BEFORE UPDATE ON hub_user_article_drafts
WHEN NEW.author_profile_id IS NOT OLD.author_profile_id
  OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT,'hub_user_article_draft_origin_immutable');
END;
