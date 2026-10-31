PRAGMA foreign_keys = ON;

ALTER TABLE profile_wallet_links ADD COLUMN minimum_tip_wei TEXT NOT NULL DEFAULT '0'
  CHECK (minimum_tip_wei GLOB '[0-9]*' AND length(minimum_tip_wei) BETWEEN 1 AND 100);
