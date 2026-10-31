CREATE TABLE IF NOT EXISTS desktop_account_profile_links (
  desktop_pairwise_subject TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  linked_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL,
  CHECK (length(desktop_pairwise_subject)=43)
);

CREATE INDEX IF NOT EXISTS idx_desktop_account_profile_links_profile
  ON desktop_account_profile_links(profile_id, last_used_at DESC);
