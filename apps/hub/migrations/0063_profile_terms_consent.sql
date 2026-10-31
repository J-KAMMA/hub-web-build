ALTER TABLE profiles ADD COLUMN terms_version TEXT;
ALTER TABLE profiles ADD COLUMN terms_accepted_at TEXT;

CREATE INDEX IF NOT EXISTS idx_profiles_terms_version
  ON profiles(terms_version);
