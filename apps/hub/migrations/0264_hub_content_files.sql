-- Gated file attachments (2026-10-15, Vault folded into Hub; docs/hub-vault-fold/INVESTIGATION.md).
--
-- The Vault-to-Hub author attribution is gone: a gated post or article is authored by its Hub
-- profile. Production and staging held 0 rows (INVESTIGATION.md section 2).
DROP TABLE IF EXISTS hub_vault_publication_attributions;
DROP TABLE IF EXISTS hub_vault_publication_proof_jtis;

-- One row per file Hub has issued an upload ticket for. The id is a random UUID minted by Hub and
-- is the only identifier the file component ever sees; it is never derived from a profile, post,
-- wallet or Account subject. Hub keeps no object key, storage URL or file body.
-- state: upload_issued -> published (attached to gated content) -> unpublish_pending -> unpublished;
-- removed when the author takes the file off. Download tickets are issued only for 'published'.
CREATE TABLE IF NOT EXISTS hub_content_files (
  id TEXT PRIMARY KEY,
  owner_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  target_type TEXT,
  target_id TEXT,
  file_name TEXT NOT NULL,
  declared_bytes INTEGER NOT NULL,
  stored_bytes INTEGER,
  state TEXT NOT NULL DEFAULT 'upload_issued',
  scan_status TEXT,
  -- Opaque handle from the Account storage API; null until storage lane C wires the client.
  storage_reservation TEXT,
  storage_committed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_at TEXT,
  unpublished_at TEXT,
  CHECK (length(id) = 36),
  CHECK (target_type IS NULL OR target_type IN ('post', 'article')),
  CHECK ((target_type IS NULL) = (target_id IS NULL)),
  CHECK (length(file_name) BETWEEN 1 AND 200),
  CHECK (declared_bytes > 0),
  CHECK (stored_bytes IS NULL OR stored_bytes > 0),
  CHECK (state IN ('upload_issued', 'published', 'unpublish_pending', 'unpublished', 'removed')),
  CHECK (state NOT IN ('published', 'unpublish_pending') OR target_id IS NOT NULL),
  CHECK (storage_committed IN (0, 1))
);

CREATE INDEX IF NOT EXISTS idx_hub_content_files_target
  ON hub_content_files(target_type, target_id, state);

CREATE INDEX IF NOT EXISTS idx_hub_content_files_owner
  ON hub_content_files(owner_profile_id, state, created_at);

CREATE INDEX IF NOT EXISTS idx_hub_content_files_pending
  ON hub_content_files(state, updated_at)
  WHERE state = 'unpublish_pending';

-- Attachments count against the same storage quota as Hub images (lane C, migration 0263): add
-- the 'content_file' kind. SQLite cannot change a CHECK in place, so hub_storage_objects is
-- rebuilt. Its release triggers reference it by name, so they are dropped first and recreated
-- unchanged from 0263 afterwards.
DROP TRIGGER IF EXISTS hub_storage_release_social_post_image_deleted;
DROP TRIGGER IF EXISTS hub_storage_release_social_post_image_removed;
DROP TRIGGER IF EXISTS hub_storage_release_dm_image_deleted;
DROP TRIGGER IF EXISTS hub_storage_release_dm_image_removed;

CREATE TABLE hub_storage_objects_0264 (
  kind TEXT NOT NULL CHECK (kind IN ('social_post_image', 'dm_image', 'community_image', 'content_file')),
  object_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  bytes INTEGER NOT NULL CHECK (bytes >= 0),
  state TEXT NOT NULL CHECK (state IN ('reserved', 'committed', 'released')),
  reservation_id TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (kind, object_id)
);
INSERT INTO hub_storage_objects_0264 (kind, object_id, profile_id, bytes, state, reservation_id, created_at)
  SELECT kind, object_id, profile_id, bytes, state, reservation_id, created_at FROM hub_storage_objects;
DROP TABLE hub_storage_objects;
ALTER TABLE hub_storage_objects_0264 RENAME TO hub_storage_objects;
CREATE INDEX IF NOT EXISTS idx_hub_storage_objects_stale_reservations
  ON hub_storage_objects (created_at) WHERE state = 'reserved';

-- Recreated unchanged from 0263.
CREATE TRIGGER IF NOT EXISTS hub_storage_release_social_post_image_deleted
AFTER UPDATE OF status ON social_post_images
WHEN NEW.status = 'deleted' AND OLD.status <> 'deleted'
BEGIN
  INSERT INTO hub_storage_outbox (id, kind, profile_id, object_kind, object_id, reservation_id, bytes, next_attempt_at, created_at)
    SELECT lower(hex(randomblob(16))), 'release', o.profile_id, o.kind, o.object_id, o.reservation_id, o.bytes,
           strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    FROM hub_storage_objects o WHERE o.kind = 'social_post_image' AND o.object_id = NEW.id AND o.state = 'committed';
  UPDATE hub_storage_usage
    SET committed_bytes = max(0, committed_bytes - (SELECT o.bytes FROM hub_storage_objects o WHERE o.kind = 'social_post_image' AND o.object_id = NEW.id AND o.state = 'committed')),
        object_count = max(0, object_count - 1),
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE profile_id = (SELECT o.profile_id FROM hub_storage_objects o WHERE o.kind = 'social_post_image' AND o.object_id = NEW.id AND o.state = 'committed');
  UPDATE hub_storage_objects SET state = 'released'
    WHERE kind = 'social_post_image' AND object_id = NEW.id AND state = 'committed';
END;

CREATE TRIGGER IF NOT EXISTS hub_storage_release_social_post_image_removed
AFTER DELETE ON social_post_images
BEGIN
  INSERT INTO hub_storage_outbox (id, kind, profile_id, object_kind, object_id, reservation_id, bytes, next_attempt_at, created_at)
    SELECT lower(hex(randomblob(16))), 'release', o.profile_id, o.kind, o.object_id, o.reservation_id, o.bytes,
           strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    FROM hub_storage_objects o WHERE o.kind = 'social_post_image' AND o.object_id = OLD.id AND o.state = 'committed';
  UPDATE hub_storage_usage
    SET committed_bytes = max(0, committed_bytes - (SELECT o.bytes FROM hub_storage_objects o WHERE o.kind = 'social_post_image' AND o.object_id = OLD.id AND o.state = 'committed')),
        object_count = max(0, object_count - 1),
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE profile_id = (SELECT o.profile_id FROM hub_storage_objects o WHERE o.kind = 'social_post_image' AND o.object_id = OLD.id AND o.state = 'committed');
  UPDATE hub_storage_objects SET state = 'released'
    WHERE kind = 'social_post_image' AND object_id = OLD.id AND state = 'committed';
END;

CREATE TRIGGER IF NOT EXISTS hub_storage_release_dm_image_deleted
AFTER UPDATE OF status ON direct_message_images
WHEN NEW.status = 'deleted' AND OLD.status <> 'deleted'
BEGIN
  INSERT INTO hub_storage_outbox (id, kind, profile_id, object_kind, object_id, reservation_id, bytes, next_attempt_at, created_at)
    SELECT lower(hex(randomblob(16))), 'release', o.profile_id, o.kind, o.object_id, o.reservation_id, o.bytes,
           strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    FROM hub_storage_objects o WHERE o.kind = 'dm_image' AND o.object_id = NEW.id AND o.state = 'committed';
  UPDATE hub_storage_usage
    SET committed_bytes = max(0, committed_bytes - (SELECT o.bytes FROM hub_storage_objects o WHERE o.kind = 'dm_image' AND o.object_id = NEW.id AND o.state = 'committed')),
        object_count = max(0, object_count - 1),
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE profile_id = (SELECT o.profile_id FROM hub_storage_objects o WHERE o.kind = 'dm_image' AND o.object_id = NEW.id AND o.state = 'committed');
  UPDATE hub_storage_objects SET state = 'released'
    WHERE kind = 'dm_image' AND object_id = NEW.id AND state = 'committed';
END;

CREATE TRIGGER IF NOT EXISTS hub_storage_release_dm_image_removed
AFTER DELETE ON direct_message_images
BEGIN
  INSERT INTO hub_storage_outbox (id, kind, profile_id, object_kind, object_id, reservation_id, bytes, next_attempt_at, created_at)
    SELECT lower(hex(randomblob(16))), 'release', o.profile_id, o.kind, o.object_id, o.reservation_id, o.bytes,
           strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    FROM hub_storage_objects o WHERE o.kind = 'dm_image' AND o.object_id = OLD.id AND o.state = 'committed';
  UPDATE hub_storage_usage
    SET committed_bytes = max(0, committed_bytes - (SELECT o.bytes FROM hub_storage_objects o WHERE o.kind = 'dm_image' AND o.object_id = OLD.id AND o.state = 'committed')),
        object_count = max(0, object_count - 1),
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE profile_id = (SELECT o.profile_id FROM hub_storage_objects o WHERE o.kind = 'dm_image' AND o.object_id = OLD.id AND o.state = 'committed');
  UPDATE hub_storage_objects SET state = 'released'
    WHERE kind = 'dm_image' AND object_id = OLD.id AND state = 'committed';
END;
