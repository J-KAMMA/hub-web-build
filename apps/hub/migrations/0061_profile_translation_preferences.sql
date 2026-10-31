PRAGMA foreign_keys = ON;

-- Hub-local presentation preference. It contains no identity, contact,
-- wallet, Vault, Music, Commerce, or KYC identifier.
CREATE TABLE IF NOT EXISTS profile_translation_preferences (
  profile_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  display_mode TEXT NOT NULL DEFAULT 'auto',
  updated_at TEXT NOT NULL,
  CHECK (display_mode IN ('auto', 'always', 'never'))
);

