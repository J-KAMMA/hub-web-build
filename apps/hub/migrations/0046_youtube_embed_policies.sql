-- Cache only public YouTube embed policy fields. No viewer identity, search term,
-- authorization token, or YouTube account data is stored.
CREATE TABLE IF NOT EXISTS youtube_embed_policies (
  video_id TEXT PRIMARY KEY,
  allowed INTEGER NOT NULL CHECK (allowed IN (0, 1)),
  made_for_kids INTEGER NOT NULL CHECK (made_for_kids IN (0, 1)),
  reason TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_youtube_embed_policies_expiry
  ON youtube_embed_policies(expires_at);
