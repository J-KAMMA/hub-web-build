-- Work deliveries (2026-10-29; docs/hub-commissions/DESIGN.md 6.3) reuse the gated file component flow, so a
-- file may be bound to target_type 'work' (target_id = the contract ID). The table is rebuilt only to widen
-- the CHECK, exactly as 0273 did for 'game'. Files only: not applied to any D1 database from this change.
CREATE TABLE hub_content_files_0297 (
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
  CHECK (target_type IS NULL OR target_type IN ('post', 'article', 'game', 'work')),
  CHECK ((target_type IS NULL) = (target_id IS NULL)),
  CHECK (length(file_name) BETWEEN 1 AND 200),
  CHECK (declared_bytes > 0),
  CHECK (stored_bytes IS NULL OR stored_bytes > 0),
  CHECK (state IN ('upload_issued', 'published', 'unpublish_pending', 'unpublished', 'removed')),
  CHECK (state NOT IN ('published', 'unpublish_pending') OR target_id IS NOT NULL),
  CHECK (storage_committed IN (0, 1))
);
INSERT INTO hub_content_files_0297 SELECT id, owner_profile_id, target_type, target_id, file_name, declared_bytes,
  stored_bytes, state, scan_status, storage_reservation, storage_committed, created_at, updated_at, published_at, unpublished_at
  FROM hub_content_files;
DROP TABLE hub_content_files;
ALTER TABLE hub_content_files_0297 RENAME TO hub_content_files;
CREATE INDEX IF NOT EXISTS idx_hub_content_files_target
  ON hub_content_files(target_type, target_id, state);
CREATE INDEX IF NOT EXISTS idx_hub_content_files_owner
  ON hub_content_files(owner_profile_id, state, created_at);
CREATE INDEX IF NOT EXISTS idx_hub_content_files_pending
  ON hub_content_files(state, updated_at)
  WHERE state = 'unpublish_pending';
