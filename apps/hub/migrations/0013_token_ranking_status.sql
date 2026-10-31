PRAGMA foreign_keys = ON;

-- Synchronization metadata contains aggregates and operational status only.
-- Hub must not persist holder wallet addresses or Hub-to-wallet mappings.
ALTER TABLE token_rankings ADD COLUMN verification_status TEXT NOT NULL DEFAULT 'pending'
  CHECK (verification_status IN ('pending', 'verified', 'failed', 'not_applicable'));
ALTER TABLE token_rankings ADD COLUMN last_verified_at TEXT;
ALTER TABLE token_rankings ADD COLUMN last_synced_at TEXT;
ALTER TABLE token_rankings ADD COLUMN holder_count INTEGER NOT NULL DEFAULT 0 CHECK (holder_count >= 0);
ALTER TABLE token_rankings ADD COLUMN sync_error TEXT CHECK (sync_error IS NULL OR length(sync_error) <= 500);
