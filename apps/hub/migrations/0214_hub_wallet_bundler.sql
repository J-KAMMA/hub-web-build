PRAGMA foreign_keys = ON;

-- Hub運用バンドラーの送信台帳と利用制限。
-- op_hash → tx_hash の対応は eth_getUserOperationReceipt の応答に使う。
CREATE TABLE IF NOT EXISTS hub_wallet_user_operations (
  user_op_hash TEXT NOT NULL PRIMARY KEY,
  transaction_hash TEXT NOT NULL,
  sender TEXT NOT NULL,
  chain_id TEXT NOT NULL,
  success INTEGER NOT NULL,
  submitted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (length(user_op_hash) = 66),
  CHECK (length(transaction_hash) = 66)
);

CREATE INDEX IF NOT EXISTS idx_hub_wallet_user_operations_sender
  ON hub_wallet_user_operations(chain_id, sender, submitted_at);

-- プロフィールあたりの送信・読み取りバケット。
CREATE TABLE IF NOT EXISTS hub_wallet_bundler_rate_limits (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  window_started_at TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 1,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (profile_id, action, window_started_at),
  CHECK (action IN ('send', 'rpc')),
  CHECK (request_count > 0)
);

CREATE INDEX IF NOT EXISTS idx_hub_wallet_bundler_rate_limits_expiry
  ON hub_wallet_bundler_rate_limits(expires_at);
