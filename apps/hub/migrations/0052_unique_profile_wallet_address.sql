PRAGMA foreign_keys = ON;

-- An EVM address represents one wallet identity across supported chains.
-- Prevent it from being claimed by more than one Hub profile even if a
-- different chain was selected during verification.
CREATE UNIQUE INDEX IF NOT EXISTS idx_profile_wallet_links_address_unique
  ON profile_wallet_links(wallet_address);
