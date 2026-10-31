-- Game builds, owner downloads and the age check (owner approved 2026-10-16/18;
-- docs/hub-software/PLAN.md §2.5 step 7, §2.7, §2.8, §9 Q5; DRM.md §9A ④ and §10).
--
-- 1. Game builds are file-component files. They reuse hub_content_files (upload ticket, publish,
--    unpublish, storage quota) with target_type 'game'; the table is rebuilt only to widen the CHECK.
-- 2. game_guide_hubs.age_rating is the creator's own rating (all / 12 / 15 / 18). NULL means 'all'.
-- 3. hub_game_age_declarations records only that the profile itself declared it is 18 or older, and
--    when. No birthdate, legal identity or Identity result is stored (Q5 is a self-declaration).
-- 4. hub_game_builds: version metadata and the creator-registered SHA-256 of the original build.
-- 5. hub_game_build_downloads: the per-buyer watermark. Each row's random ID is the download ticket's
--    jti, which the file component signs into the download manifest beside the untouched build.
--    The ID -> purchase mapping stays only here and is purged 3 years after the sale (DRM.md §10).

CREATE TABLE hub_content_files_0273 (
  id TEXT PRIMARY KEY,
  owner_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  target_type TEXT,
  target_id TEXT,
  file_name TEXT NOT NULL,
  declared_bytes INTEGER NOT NULL,
  stored_bytes INTEGER,
  state TEXT NOT NULL DEFAULT 'upload_issued',
  scan_status TEXT,
  storage_reservation TEXT,
  storage_committed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_at TEXT,
  unpublished_at TEXT,
  CHECK (length(id) = 36),
  CHECK (target_type IS NULL OR target_type IN ('post', 'article', 'game')),
  CHECK ((target_type IS NULL) = (target_id IS NULL)),
  CHECK (length(file_name) BETWEEN 1 AND 200),
  CHECK (declared_bytes > 0),
  CHECK (stored_bytes IS NULL OR stored_bytes > 0),
  CHECK (state IN ('upload_issued', 'published', 'unpublish_pending', 'unpublished', 'removed')),
  CHECK (state NOT IN ('published', 'unpublish_pending') OR target_id IS NOT NULL),
  CHECK (storage_committed IN (0, 1))
);
INSERT INTO hub_content_files_0273 SELECT id, owner_profile_id, target_type, target_id, file_name, declared_bytes,
  stored_bytes, state, scan_status, storage_reservation, storage_committed, created_at, updated_at, published_at, unpublished_at
  FROM hub_content_files;
DROP TABLE hub_content_files;
ALTER TABLE hub_content_files_0273 RENAME TO hub_content_files;
CREATE INDEX IF NOT EXISTS idx_hub_content_files_target
  ON hub_content_files(target_type, target_id, state);
CREATE INDEX IF NOT EXISTS idx_hub_content_files_owner
  ON hub_content_files(owner_profile_id, state, created_at);
CREATE INDEX IF NOT EXISTS idx_hub_content_files_pending
  ON hub_content_files(state, updated_at)
  WHERE state = 'unpublish_pending';

ALTER TABLE game_guide_hubs ADD COLUMN age_rating TEXT
  CHECK (age_rating IS NULL OR age_rating IN ('all', '12', '15', '18'));
-- The refund push names only the Commerce product; Hub finds the listing by it.
CREATE INDEX IF NOT EXISTS idx_game_guide_hubs_commerce_product
  ON game_guide_hubs(commerce_product_id) WHERE commerce_product_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS hub_game_age_declarations (
  profile_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  declared_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hub_game_builds (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  game_id TEXT NOT NULL REFERENCES game_guide_hubs(id) ON DELETE CASCADE,
  file_id TEXT NOT NULL UNIQUE CHECK (length(file_id) = 36),
  version TEXT NOT NULL CHECK (length(version) BETWEEN 1 AND 64),
  platform TEXT NOT NULL CHECK (platform IN ('windows', 'macos', 'linux')),
  kind TEXT NOT NULL CHECK (kind IN ('full', 'demo')),
  channel TEXT NOT NULL CHECK (channel IN ('stable', 'beta')),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  notes TEXT CHECK (notes IS NULL OR length(notes) <= 2000),
  created_by_profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hub_game_builds_game
  ON hub_game_builds(game_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hub_game_builds_creator
  ON hub_game_builds(created_by_profile_id);

CREATE TABLE IF NOT EXISTS hub_game_build_downloads (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  profile_id TEXT REFERENCES profiles(id) ON DELETE CASCADE,
  game_id TEXT NOT NULL,
  build_id TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  purge_after TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hub_game_build_downloads_purge ON hub_game_build_downloads(purge_after);
CREATE INDEX IF NOT EXISTS idx_hub_game_build_downloads_profile ON hub_game_build_downloads(profile_id, game_id);
