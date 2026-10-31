-- 記事のコメント。
--
-- コメントは記事の表（hub_user_articles）へ列を足さず、別表に置く。記事ごとの
-- 「コメントを受け付けるか」も別表（既定はオン。行が無ければオン）。
-- 記事idは下書きidを引き継ぐので、公開前の下書きにも設定の行を先に作れる。
-- そのため settings の article_id は記事表への外部キーにせず、書き手の
-- profile への外部キー（アカウント削除で消える）だけを持つ。
--
-- 削除は status='removed' にして本文を空にする。削除できるのはコメント本人・
-- 記事の書き手・運営。通報は通報時点の抜粋を持つので、削除後も運営が内容を確認できる。

CREATE TABLE IF NOT EXISTS hub_user_article_comments (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL REFERENCES hub_user_articles(id) ON DELETE CASCADE,
  author_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published',
  removed_by TEXT,
  created_at TEXT NOT NULL,
  removed_at TEXT,
  CHECK (status IN ('published', 'removed')),
  CHECK (removed_by IS NULL OR removed_by IN ('author', 'article_author', 'moderator')),
  CHECK (length(body) <= 2000),
  CHECK (status = 'removed' OR length(body) >= 1)
);

CREATE INDEX IF NOT EXISTS idx_hub_user_article_comments_page
  ON hub_user_article_comments(article_id, created_at, id);
CREATE INDEX IF NOT EXISTS idx_hub_user_article_comments_author
  ON hub_user_article_comments(author_profile_id);

CREATE TABLE IF NOT EXISTS hub_user_article_comment_settings (
  article_id TEXT PRIMARY KEY,
  owner_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  comments_enabled INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  CHECK (comments_enabled IN (0, 1))
);

CREATE TABLE IF NOT EXISTS hub_user_article_comment_reports (
  id TEXT PRIMARY KEY,
  comment_id TEXT NOT NULL REFERENCES hub_user_article_comments(id) ON DELETE CASCADE,
  article_id TEXT NOT NULL,
  reporter_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  excerpt TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL,
  CHECK (status IN ('open', 'resolved', 'dismissed')),
  CHECK (length(reason) BETWEEN 1 AND 300),
  CHECK (length(excerpt) <= 300),
  UNIQUE (comment_id, reporter_profile_id)
);

CREATE INDEX IF NOT EXISTS idx_hub_user_article_comment_reports_status
  ON hub_user_article_comment_reports(status, created_at);

CREATE TABLE IF NOT EXISTS hub_user_article_comment_rate_limit_buckets (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  window_started_at TEXT NOT NULL,
  request_count INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (profile_id, window_started_at)
);
