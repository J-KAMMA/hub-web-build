PRAGMA foreign_keys = ON;

-- Community artwork is public Hub product data. It must not contain or encode
-- Identity, commerce, wallet-owner, or cross-service account identifiers.
ALTER TABLE communities ADD COLUMN image_url TEXT;
