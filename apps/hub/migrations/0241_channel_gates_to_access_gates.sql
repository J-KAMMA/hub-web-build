-- Hub token gates, lane F (docs/hub-token-gates/DESIGN.md section 7).
-- Converts every community channel token gate (community_channels.token_gate_id)
-- into an access_gates row attached through content_access_gates.
--
-- Fail closed: a gate is created for EVERY gated channel. The old check matched
-- balances by symbol only and had no expiry, so nothing is carried over as an
-- open condition unless it can be expressed exactly:
--   * contract on an allowlisted chain AND no positive minimum -> one erc20
--     condition with min_raw = 1 (hold any amount).
--   * everything else (no contract, unknown network, a positive minimum whose
--     raw amount needs decimals() that only a later check can read) -> a gate
--     with ZERO conditions. Zero conditions admits nobody; the community
--     administrator must set the condition again. The old numbers stay in the
--     gate description so the administrator can see what to re-enter.
-- Old columns are kept (community_channels.token_gate_id / minimum_token_balance)
-- but are no longer read; 0242 removes them in the next release.
-- Idempotent: channels that already have a content_access_gates row are skipped.

INSERT OR IGNORE INTO access_gates
  (id, owner_profile_id, match, description, acquisition_url, version, created_at, updated_at)
SELECT
  'migrated-channel-' || c.id,
  t.created_by_profile_id,
  'all',
  substr('旧トークン条件の移行: 条件の再設定が必要です（旧: ' || t.symbol || ' ' ||
    COALESCE(NULLIF(trim(c.minimum_token_balance), ''), '0') || ' 以上 / ' || t.network || '）', 1, 280),
  NULL,
  1,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM community_channels c
JOIN community_tokens t ON t.id = c.token_gate_id
WHERE c.token_gate_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM content_access_gates existing
    WHERE existing.target_type = 'channel' AND existing.target_id = c.id
  );

-- Exactly mappable gates get their one erc20 condition.
INSERT OR IGNORE INTO access_gate_conditions
  (gate_id, ordinal, kind, chain_id, contract, min_raw, token_ids, decimals)
SELECT
  'migrated-channel-' || c.id, 0, 'erc20',
  CASE lower(trim(t.network))
    WHEN 'ethereum' THEN 1 WHEN 'mainnet' THEN 1 WHEN 'eth' THEN 1
    WHEN 'polygon' THEN 137 WHEN 'matic' THEN 137
    WHEN 'base' THEN 8453
    WHEN 'arbitrum' THEN 42161 WHEN 'arbitrum one' THEN 42161
    WHEN 'optimism' THEN 10 WHEN 'op' THEN 10 WHEN 'op mainnet' THEN 10
    WHEN 'amoy' THEN 80002 WHEN 'polygon amoy' THEN 80002
    WHEN 'avalanche' THEN 43114 WHEN 'avax' THEN 43114 WHEN 'avalanche c-chain' THEN 43114
    WHEN 'fuji' THEN 43113
  END,
  lower(t.contract_address), '1', '[]', NULL
FROM community_channels c
JOIN community_tokens t ON t.id = c.token_gate_id
WHERE c.token_gate_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM access_gates g WHERE g.id = 'migrated-channel-' || c.id)
  AND length(t.contract_address) = 42
  AND lower(substr(t.contract_address, 1, 2)) = '0x'
  AND substr(t.contract_address, 3) NOT GLOB '*[^0-9a-fA-F]*'
  AND lower(trim(t.network)) IN ('ethereum', 'mainnet', 'eth', 'polygon', 'matic', 'base',
    'arbitrum', 'arbitrum one', 'optimism', 'op', 'op mainnet', 'amoy', 'polygon amoy',
    'avalanche', 'avax', 'avalanche c-chain', 'fuji')
  AND (
    c.minimum_token_balance IS NULL OR trim(c.minimum_token_balance) = ''
    OR (trim(c.minimum_token_balance) NOT GLOB '*[^0-9.]*' AND CAST(trim(c.minimum_token_balance) AS REAL) = 0)
  );

INSERT OR IGNORE INTO content_access_gates (target_type, target_id, gate_id, created_at)
SELECT 'channel', c.id, 'migrated-channel-' || c.id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM community_channels c
WHERE c.token_gate_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM access_gates g WHERE g.id = 'migrated-channel-' || c.id);
