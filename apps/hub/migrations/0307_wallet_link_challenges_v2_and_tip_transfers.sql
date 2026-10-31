-- Non-EVM wallet links and tips (docs/hub-multichain/SOLANA-BITCOIN-DESIGN.md, M2 and M4).
--
-- wallet_link_challenges_v2: one-time challenges for Solana (Sign-In With Solana) and Bitcoin links. The 0071
-- table stays for EVM. The nonce itself is not stored, only its hash; the exact issued message is checked by
-- SHA-256. A challenge is bound to one profile, one chain reference (CAIP-2) and one address.
--
-- wallet_tip_transfers: ledger for confirmed non-EVM native tips (SOL, BTC). wallet_tip_transactions (EVM) is
-- untouched. No sender address column, as for EVM; the same transaction cannot be claimed twice.
CREATE TABLE IF NOT EXISTS wallet_link_challenges_v2 (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  namespace TEXT NOT NULL CHECK (namespace IN ('eip155', 'solana', 'bip122')),
  chain_ref TEXT NOT NULL CHECK (length(chain_ref) BETWEEN 8 AND 80),
  normalized_address TEXT NOT NULL CHECK (length(normalized_address) BETWEEN 26 AND 90),
  nonce_hash TEXT NOT NULL CHECK (length(nonce_hash) = 64),
  message_sha256 TEXT NOT NULL CHECK (length(message_sha256) = 64),
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_wallet_link_challenges_v2_expiry
  ON wallet_link_challenges_v2(expires_at, used_at);
CREATE INDEX IF NOT EXISTS idx_wallet_link_challenges_v2_profile
  ON wallet_link_challenges_v2(profile_id, issued_at DESC);

CREATE TABLE IF NOT EXISTS wallet_tip_transfers (
  id TEXT PRIMARY KEY,
  chain_ref TEXT NOT NULL,
  tx_ref TEXT NOT NULL,
  asset_ref TEXT NOT NULL,
  amount_raw TEXT NOT NULL CHECK (amount_raw GLOB '[1-9]*' AND length(amount_raw) <= 40),
  sender_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  recipient_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  recipient_wallet_account_id TEXT REFERENCES profile_wallet_accounts(id) ON DELETE SET NULL,
  confirmed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (chain_ref, tx_ref),
  CHECK (sender_profile_id <> recipient_profile_id)
);
CREATE INDEX IF NOT EXISTS idx_wallet_tip_transfers_recipient
  ON wallet_tip_transfers(recipient_profile_id, confirmed_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_tip_transfers_sender
  ON wallet_tip_transfers(sender_profile_id, confirmed_at DESC);
