-- Game store backend (owner approved 2026-10-18; docs/hub-software/PLAN.md §2.5, Q1–Q13; DRM.md Q-D1–10).
--
-- A game listing is free (Hub adds it to the library without Commerce) or paid (it names one
-- Commerce digital product; price, checkout, orders and refunds stay in Commerce). Hub records
-- ownership only from a verified Commerce game-entitlement proof or a free add.

ALTER TABLE game_guide_hubs ADD COLUMN store_listing TEXT
  CHECK (store_listing IS NULL OR store_listing IN ('free', 'paid'));
ALTER TABLE game_guide_hubs ADD COLUMN commerce_product_id TEXT
  CHECK (commerce_product_id IS NULL OR length(commerce_product_id) = 36);
ALTER TABLE game_guide_hubs ADD COLUMN requirements_minimum TEXT
  CHECK (requirements_minimum IS NULL OR length(requirements_minimum) <= 2000);
ALTER TABLE game_guide_hubs ADD COLUMN requirements_recommended TEXT
  CHECK (requirements_recommended IS NULL OR length(requirements_recommended) <= 2000);

-- Screenshots live in the Hub media bucket under the same key scheme and limits as the game image.
CREATE TABLE IF NOT EXISTS hub_game_screenshots (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES game_guide_hubs(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position BETWEEN 0 AND 7),
  rights_basis TEXT NOT NULL CHECK (rights_basis IN ('official_permission', 'user_created', 'licensed')),
  attribution TEXT CHECK (attribution IS NULL OR length(attribution) <= 200),
  created_at TEXT NOT NULL,
  UNIQUE (game_id, position)
);

-- One row per Commerce grant (the proof's jti, stable per order). The jti binds to the first
-- Hub profile that redeems it; nobody else can redeem it again. Kept with a NULL profile after
-- the profile is deleted so the order cannot be redeemed a second time.
CREATE TABLE IF NOT EXISTS hub_game_grants (
  grant_jti TEXT PRIMARY KEY CHECK (length(grant_jti) = 36),
  profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  game_id TEXT NOT NULL REFERENCES game_guide_hubs(id) ON DELETE CASCADE,
  granted_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_hub_game_grants_profile_game
  ON hub_game_grants(profile_id, game_id);

-- The owned-games library: free adds and games with at least one unrevoked Commerce grant.
CREATE TABLE IF NOT EXISTS hub_game_library (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  game_id TEXT NOT NULL REFERENCES game_guide_hubs(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('free', 'commerce')),
  added_at TEXT NOT NULL,
  PRIMARY KEY (profile_id, game_id)
);
CREATE INDEX IF NOT EXISTS idx_hub_game_library_profile_added
  ON hub_game_library(profile_id, added_at DESC, game_id DESC);
