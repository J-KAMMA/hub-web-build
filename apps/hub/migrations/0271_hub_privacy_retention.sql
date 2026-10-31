-- Scheduled retention for viewer hashes, IP hashes and wallet senders (owner decision 2026-10-18;
-- docs/hub-privacy/AUDIT.md 8.3-3 and 8.8). The job is lib/server/privacy-retention.ts.
--
-- Every purge below walks an index whose leading column is the retention time, so a pass reads only
-- the rows it changes. The partial indexes drop a row as soon as it is nulled, so finished rows are
-- never read again.

-- external_video_views rows older than 90 days are deleted. The lifetime view count shown on a video
-- must not shrink, so the deleted rows are first added to this counter (in the same batch).
ALTER TABLE external_videos ADD COLUMN archived_view_count INTEGER NOT NULL DEFAULT 0;

-- video_playback_events is deleted by event_day; its only index leads with video_id.
CREATE INDEX IF NOT EXISTS idx_video_playback_events_day ON video_playback_events(event_day);

-- hubpedia_wiki_activity_events keeps the row (per-profile limits, abuse review) and nulls the IP hash.
CREATE INDEX IF NOT EXISTS idx_hubpedia_wiki_activity_ip_retention
  ON hubpedia_wiki_activity_events(created_at) WHERE client_ip_hash IS NOT NULL;

-- hub_wallet_user_operations.sender (a wallet address) becomes nullable so it can be cleared one year
-- after confirmation while op_hash -> tx_hash keeps answering eth_getUserOperationReceipt (the sender is
-- then read from the on-chain UserOperationEvent). No table references this one.
CREATE TABLE hub_wallet_user_operations_retention (
  user_op_hash TEXT NOT NULL PRIMARY KEY,
  transaction_hash TEXT NOT NULL,
  sender TEXT,
  chain_id TEXT NOT NULL,
  success INTEGER NOT NULL,
  -- Written after the transaction receipt arrives, so this is the confirmation time.
  submitted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (length(user_op_hash) = 66),
  CHECK (length(transaction_hash) = 66)
);
INSERT INTO hub_wallet_user_operations_retention (user_op_hash, transaction_hash, sender, chain_id, success, submitted_at)
  SELECT user_op_hash, transaction_hash, sender, chain_id, success, submitted_at FROM hub_wallet_user_operations;
DROP TABLE hub_wallet_user_operations;
ALTER TABLE hub_wallet_user_operations_retention RENAME TO hub_wallet_user_operations;

CREATE INDEX IF NOT EXISTS idx_hub_wallet_user_operations_sender
  ON hub_wallet_user_operations(chain_id, sender, submitted_at);
CREATE INDEX IF NOT EXISTS idx_hub_wallet_user_operations_sender_retention
  ON hub_wallet_user_operations(submitted_at) WHERE sender IS NOT NULL;
