ALTER TABLE social_posts ADD COLUMN client_request_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_social_posts_author_client_request
  ON social_posts(author_profile_id, client_request_id)
  WHERE author_profile_id IS NOT NULL AND client_request_id IS NOT NULL;
