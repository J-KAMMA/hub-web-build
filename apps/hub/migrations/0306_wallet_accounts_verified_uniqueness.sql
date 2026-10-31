-- Wallet accounts: only VERIFIED links claim an address (docs/hub-multichain/SOLANA-BITCOIN-DESIGN.md, M1).
--
-- Defect fixed: profile_wallet_accounts had UNIQUE(namespace, normalized_address) across all profiles, so any
-- profile could add someone else's address as a watch-only entry and block its real owner from linking it.
-- Now (profile_id, namespace, normalized_address) is unique per profile, and a partial unique index allows at
-- most one VERIFIED row per (namespace, normalized_address). Watch-only rows never block anyone.
--
-- Also adds the tip settings columns (tips_enabled, minimum_tip_raw; tips only on verified rows) and
-- address_kind. normalized_address has no NOCASE collation: base58 addresses are case-sensitive, EVM
-- addresses are stored lowercase by the application.
--
-- SQLite cannot change a UNIQUE constraint in place, so the table is rebuilt (create new, copy, drop,
-- rename) the way 0281 did it. wallet_account_networks references this table; its rows are backed up first
-- and restored afterwards in case the DROP cascades.
PRAGMA foreign_keys = OFF;
PRAGMA defer_foreign_keys = ON;

CREATE TABLE wallet_account_networks_backup_0306 AS
  SELECT wallet_account_id, network_reference, enabled, created_at FROM wallet_account_networks;

CREATE TABLE profile_wallet_accounts_new (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  namespace TEXT NOT NULL,
  normalized_address TEXT NOT NULL,
  display_address TEXT NOT NULL,
  address_kind TEXT,
  verification_status TEXT NOT NULL CHECK(verification_status IN ('verified','watch_only')),
  verification_method TEXT CHECK(verification_method IS NULL OR verification_method IN
    ('personal_sign','eip712_profile_link','siws_ed25519','bip322_simple','bip322_full','bip137_legacy')),
  verified_at TEXT,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK(visibility IN ('private','public')),
  tips_enabled INTEGER NOT NULL DEFAULT 0 CHECK(tips_enabled IN (0,1)),
  minimum_tip_raw TEXT NOT NULL DEFAULT '0' CHECK(minimum_tip_raw GLOB '[0-9]*'),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(profile_id, namespace, normalized_address),
  CHECK(length(namespace) BETWEEN 2 AND 32),
  CHECK(length(normalized_address) BETWEEN 3 AND 256),
  CHECK(verification_status = 'watch_only' OR verification_method IS NOT NULL),
  CHECK(tips_enabled = 0 OR verification_status = 'verified')
);

INSERT INTO profile_wallet_accounts_new
  (id, profile_id, namespace, normalized_address, display_address, address_kind,
   verification_status, verification_method, verified_at, visibility,
   tips_enabled, minimum_tip_raw, created_at, updated_at)
SELECT
  id, profile_id, namespace, normalized_address, display_address,
  CASE WHEN namespace = 'eip155' THEN 'evm' ELSE NULL END,
  verification_status,
  CASE
    WHEN verification_status = 'watch_only' THEN NULL
    WHEN verification_method IN ('personal_sign','eip712_profile_link') THEN verification_method
    ELSE 'personal_sign'
  END,
  verified_at, visibility, 0, '0', created_at, updated_at
FROM profile_wallet_accounts;

DROP TABLE profile_wallet_accounts;
ALTER TABLE profile_wallet_accounts_new RENAME TO profile_wallet_accounts;

CREATE INDEX idx_profile_wallet_accounts_profile
  ON profile_wallet_accounts(profile_id, created_at DESC);

-- One address, one profile, for verified links only.
CREATE UNIQUE INDEX ux_wallet_accounts_verified_address
  ON profile_wallet_accounts(namespace, normalized_address) WHERE verification_status = 'verified';

INSERT OR IGNORE INTO wallet_account_networks (wallet_account_id, network_reference, enabled, created_at)
SELECT b.wallet_account_id, b.network_reference, b.enabled, b.created_at
FROM wallet_account_networks_backup_0306 b
JOIN profile_wallet_accounts a ON a.id = b.wallet_account_id;

DROP TABLE wallet_account_networks_backup_0306;

PRAGMA defer_foreign_keys = OFF;
PRAGMA foreign_keys = ON;
