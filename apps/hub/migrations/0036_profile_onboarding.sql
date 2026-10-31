PRAGMA foreign_keys = ON;

-- Hub-local product preferences only. Do not add contact, Identity, Vault,
-- Commerce, KYC, or wallet identifiers to this table.
CREATE TABLE IF NOT EXISTS profile_onboarding (
  profile_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  interests_json TEXT NOT NULL DEFAULT '[]',
  completed_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (json_valid(interests_json)),
  CHECK (length(interests_json) <= 1000)
);

CREATE INDEX IF NOT EXISTS idx_profile_onboarding_updated
  ON profile_onboarding(updated_at DESC);
