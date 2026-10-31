PRAGMA foreign_keys = ON;

-- A public token gets one ranking per network. This stores token metadata only;
-- wallet addresses and Hub-to-wallet mappings remain outside Hub D1.
CREATE UNIQUE INDEX IF NOT EXISTS idx_token_rankings_network_symbol_unique
  ON token_rankings(network, symbol);
