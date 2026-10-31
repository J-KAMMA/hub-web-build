-- Token gates on Solana and Bitcoin (docs/hub-multichain/SOLANA-BITCOIN-DESIGN.md, M3).
--
-- access_gate_conditions gets a CAIP-2 chain_ref (backfilled 'eip155:' || chain_id) and the kinds sol_native, spl,
-- spl_mints and btc_native. chain_id and contract become EVM-only (NULL for Solana native and Bitcoin native;
-- contract holds the SPL mint for spl/spl_mints). token_ids holds the mint list for spl_mints. min_raw is
-- lamports, base units or satoshis.
--
-- SQLite cannot change a CHECK in place, so the table is rebuilt (create new, copy, drop, rename) the way
-- 0281 did it. No other table references access_gate_conditions.
PRAGMA foreign_keys = OFF;
PRAGMA defer_foreign_keys = ON;

CREATE TABLE access_gate_conditions_new (
  gate_id TEXT NOT NULL REFERENCES access_gates(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  kind TEXT NOT NULL,
  chain_ref TEXT NOT NULL DEFAULT '',
  chain_id INTEGER,
  contract TEXT,
  min_raw TEXT NOT NULL DEFAULT '0',
  token_ids TEXT NOT NULL DEFAULT '[]',
  decimals INTEGER,
  PRIMARY KEY (gate_id, ordinal),
  CHECK (ordinal >= 0 AND ordinal < 5),
  CHECK (kind IN ('erc20', 'erc721', 'erc1155', 'sol_native', 'spl', 'spl_mints', 'btc_native')),
  CHECK (chain_ref = '' OR length(chain_ref) BETWEEN 8 AND 80),
  CHECK ((kind IN ('erc20', 'erc721', 'erc1155')) = (chain_id IS NOT NULL AND chain_id > 0)),
  CHECK (kind NOT IN ('erc20', 'erc721', 'erc1155')
         OR (length(contract) = 42 AND contract = lower(contract) AND contract LIKE '0x%')),
  CHECK (kind NOT IN ('spl', 'spl_mints') OR (contract IS NOT NULL AND length(contract) BETWEEN 32 AND 44)),
  CHECK (kind NOT IN ('sol_native', 'btc_native') OR contract IS NULL),
  CHECK (length(min_raw) BETWEEN 1 AND 78),
  CHECK (decimals IS NULL OR (decimals >= 0 AND decimals <= 255))
);

INSERT INTO access_gate_conditions_new
  (gate_id, ordinal, kind, chain_ref, chain_id, contract, min_raw, token_ids, decimals)
SELECT gate_id, ordinal, kind, 'eip155:' || chain_id, chain_id, contract, min_raw, token_ids, decimals
FROM access_gate_conditions;

DROP TABLE access_gate_conditions;
ALTER TABLE access_gate_conditions_new RENAME TO access_gate_conditions;

-- A writer that still inserts only chain_id (code deployed before this change) gets its chain_ref filled in, so
-- the migration can be applied before the new code is live.
CREATE TRIGGER trg_access_gate_conditions_chain_ref
AFTER INSERT ON access_gate_conditions
WHEN NEW.chain_ref = '' AND NEW.chain_id IS NOT NULL
BEGIN
  UPDATE access_gate_conditions SET chain_ref = 'eip155:' || NEW.chain_id WHERE gate_id = NEW.gate_id AND ordinal = NEW.ordinal;
END;

PRAGMA defer_foreign_keys = OFF;
PRAGMA foreign_keys = ON;
