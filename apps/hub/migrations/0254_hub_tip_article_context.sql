-- 記事から送られた投げ銭の「どの記事か」。公開中の記事IDだけで、ウォレットアドレスは持たない。
-- 記事が消えても台帳は残す（SET NULL）。NULL は記事以外（プロフィールなど）からの投げ銭。
ALTER TABLE wallet_tip_transactions ADD COLUMN article_id TEXT REFERENCES hub_user_articles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_wallet_tips_article_confirmed
  ON wallet_tip_transactions(article_id) WHERE article_id IS NOT NULL;
