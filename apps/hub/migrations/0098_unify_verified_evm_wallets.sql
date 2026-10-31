PRAGMA foreign_keys = ON;

-- Keep the general multichain wallet registry aligned with every EVM address
-- that has already passed Hub's signature-verification flow.
INSERT OR IGNORE INTO profile_wallet_accounts
  (id, profile_id, namespace, normalized_address, display_address,
   verification_status, verification_method, verified_at, visibility,
   created_at, updated_at)
SELECT
  'multichain-' || id,
  profile_id,
  'eip155',
  lower(wallet_address),
  wallet_address,
  'verified',
  'personal_sign',
  verified_at,
  visibility,
  created_at,
  verified_at
FROM profile_wallet_links;

INSERT OR IGNORE INTO wallet_account_networks
  (wallet_account_id, network_reference, enabled, created_at)
SELECT
  accounts.id,
  CAST(links.chain_id AS TEXT),
  1,
  links.created_at
FROM profile_wallet_links links
JOIN profile_wallet_accounts accounts
  ON accounts.namespace = 'eip155'
 AND accounts.normalized_address = lower(links.wallet_address);
