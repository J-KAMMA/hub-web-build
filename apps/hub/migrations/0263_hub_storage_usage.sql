-- Hub storage usage (docs/hub-storage-plans/PLAN.md section 7.3, lane C).
-- An incremental counter per Hub profile: D1 bills by rows read, so no request
-- ever SUMs over file rows. The Account-side total (for profiles linked to the
-- common Account) is owned by services/account; Hub keeps only its own local
-- counter, keyed by the Hub-local profile id. No Account identifier, pairwise
-- subject, order, price or payment data is stored here: the Hub-audience
-- subject is read from account_profile_links at the moment of an Account call.

CREATE TABLE IF NOT EXISTS hub_storage_usage (
  profile_id TEXT PRIMARY KEY,
  committed_bytes INTEGER NOT NULL DEFAULT 0 CHECK (committed_bytes >= 0),
  reserved_bytes INTEGER NOT NULL DEFAULT 0 CHECK (reserved_bytes >= 0),
  object_count INTEGER NOT NULL DEFAULT 0 CHECK (object_count >= 0),
  updated_at TEXT NOT NULL
);

-- One row per counted object, so a delete can subtract exactly what was added.
CREATE TABLE IF NOT EXISTS hub_storage_objects (
  kind TEXT NOT NULL CHECK (kind IN ('social_post_image', 'dm_image', 'community_image')),
  object_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  bytes INTEGER NOT NULL CHECK (bytes >= 0),
  state TEXT NOT NULL CHECK (state IN ('reserved', 'committed', 'released')),
  reservation_id TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (kind, object_id)
);
CREATE INDEX IF NOT EXISTS idx_hub_storage_objects_stale_reservations
  ON hub_storage_objects (created_at) WHERE state = 'reserved';

-- Commit / release / adopt notices owed to Account. Re-sent until delivered, each
-- attempt signing a fresh claim; Account de-duplicates by reservation id / key.
CREATE TABLE IF NOT EXISTS hub_storage_outbox (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('commit', 'release', 'adopt')),
  profile_id TEXT NOT NULL,
  object_kind TEXT NOT NULL,
  object_id TEXT NOT NULL,
  reservation_id TEXT,
  bytes INTEGER NOT NULL CHECK (bytes >= 0),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  delivered_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hub_storage_outbox_pending
  ON hub_storage_outbox (next_attempt_at) WHERE delivered_at IS NULL;

-- De-duplicates the near-limit and at-limit notifications.
CREATE TABLE IF NOT EXISTS hub_storage_notices (
  profile_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('near_limit', 'at_limit')),
  valid_until TEXT NOT NULL,
  PRIMARY KEY (profile_id, kind)
);

-- One-time backfill of what already exists (images that are still stored).
INSERT OR IGNORE INTO hub_storage_objects (kind, object_id, profile_id, bytes, state, reservation_id, created_at)
  SELECT 'social_post_image', id, owner_profile_id, byte_size, 'committed', NULL, created_at
  FROM social_post_images WHERE status <> 'deleted';
INSERT OR IGNORE INTO hub_storage_objects (kind, object_id, profile_id, bytes, state, reservation_id, created_at)
  SELECT 'dm_image', id, owner_profile_id, byte_size, 'committed', NULL, created_at
  FROM direct_message_images WHERE status <> 'deleted';
INSERT OR IGNORE INTO hub_storage_usage (profile_id, committed_bytes, reserved_bytes, object_count, updated_at)
  SELECT profile_id, SUM(bytes), 0, COUNT(*), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM hub_storage_objects WHERE state = 'committed' GROUP BY profile_id;

-- Any path that marks an image deleted, or removes its row, gives the bytes
-- back in the same transaction (moderation, post/DM deletion, expiry prune).
-- The guard on state = 'committed' makes a second release a no-op.
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
