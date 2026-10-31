CREATE TABLE IF NOT EXISTS hub_vault_publication_attributions (
  vault_content_id TEXT PRIMARY KEY,
  hub_profile_id TEXT NOT NULL,
  linked_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (hub_profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_hub_vault_publications_profile
  ON hub_vault_publication_attributions(hub_profile_id, linked_at DESC);

CREATE TABLE IF NOT EXISTS hub_vault_publication_proof_jtis (
  jti TEXT PRIMARY KEY,
  consumed_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
