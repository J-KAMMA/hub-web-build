CREATE TABLE IF NOT EXISTS hub_user_article_saves (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  article_id TEXT NOT NULL REFERENCES hub_user_articles(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (profile_id, article_id)
);
