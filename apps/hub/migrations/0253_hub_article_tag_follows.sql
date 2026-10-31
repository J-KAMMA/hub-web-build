-- 記事のタグのフォロー（2026-10-14）。
--
-- tag は hub_user_article_tags.tag（0248）と同じ形。記事の tags_json に入っている
-- 文字列そのままで、タグ頁が引く値と一致する。
--
-- 1人が追えるタグは100まで。コードでも数えて分かりやすい文で断るが、同時に来た
-- 要求が上限を越えないよう、挿入前のトリガーでも止める。
-- 利用者が消えれば（profiles の削除）フォローも消える。

CREATE TABLE IF NOT EXISTS hub_article_tag_follows (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (profile_id, tag),
  CHECK (length(tag) BETWEEN 1 AND 100)
);

-- タグから追っている人を引く（件数の確認・将来の通知用）。
CREATE INDEX IF NOT EXISTS idx_hub_article_tag_follows_tag
  ON hub_article_tag_follows(tag, profile_id);

CREATE TRIGGER IF NOT EXISTS HubArticleTagFollowsLimit
BEFORE INSERT ON hub_article_tag_follows
WHEN (SELECT count(*) FROM hub_article_tag_follows WHERE profile_id = NEW.profile_id) >= 100
BEGIN
  SELECT RAISE(ABORT, 'hub_article_tag_follow_limit');
END;
