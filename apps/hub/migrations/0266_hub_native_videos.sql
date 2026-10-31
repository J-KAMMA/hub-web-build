-- Hub self-made videos, Hub side (docs/hub-video/PLAN.md sections 3, 6, 7.2; AGENTS.md 2026-10-15).
--
-- Hub owns the title, description, visibility, owner and every decision about who may watch. The
-- Video Worker (apps/video) knows only `asset_id` and media state; it never sees a profile ID,
-- visibility, follow or gate. `asset_id` is a random UUID minted by Hub and is the only identifier
-- shared with the Video Worker. `id` is Hub's own random ID (also the gate target ID); neither is
-- derived from a profile, wallet, Account subject or post.
--
-- state: upload_issued -> processing -> ready -> published <-> unpublished
--        any -> rejected | failed (the Video Worker said so, or the declared length was a lie)
--        any -> deleted
-- Play tickets are issued only while state = 'published' (and the visibility / gate / age checks
-- pass). Hub marks a row unpublished or deleted BEFORE it tells the Video Worker, so a Worker that
-- is down never keeps a video playable on Hub's side.
CREATE TABLE IF NOT EXISTS hub_videos (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  visibility TEXT NOT NULL DEFAULT 'public',
  kind TEXT NOT NULL DEFAULT 'normal',
  license TEXT NOT NULL DEFAULT 'arr',
  age_restricted INTEGER NOT NULL DEFAULT 0,
  comments_enabled INTEGER NOT NULL DEFAULT 1,
  state TEXT NOT NULL DEFAULT 'upload_issued',
  failure TEXT,
  -- 'copyright' while a copyright case holds it down; a hold is never lifted by the owner.
  hold_reason TEXT,
  -- The catalog row (external_videos) that represents this video in lists and copyright cases.
  external_video_id TEXT,
  source TEXT NOT NULL,
  max_height INTEGER NOT NULL,
  -- Reported by the Video Worker once processing is done.
  duration_ms INTEGER,
  width INTEGER,
  height INTEGER,
  is_vertical INTEGER,
  processing_kind TEXT,
  received_bytes INTEGER,
  stored_bytes INTEGER,
  -- The length the uploader declared, in whole minutes. Held against the 30-day cap while the
  -- upload is open; replaced by `charged_minutes` (from the reported length) when it is ready.
  declared_minutes INTEGER NOT NULL,
  charged_minutes INTEGER,
  charged_kind TEXT,
  charged_at TEXT,
  -- Account storage reservation IDs (hub-video-storage.ts). Hub's Hub-audience pairwise subject is
  -- looked up per call from account_profile_links and is never stored here.
  upload_bytes INTEGER NOT NULL,
  upload_reservation_id TEXT,
  upload_committed INTEGER NOT NULL DEFAULT 0,
  upload_released INTEGER NOT NULL DEFAULT 0,
  stored_reservation_id TEXT,
  stored_released INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_at TEXT,
  unpublished_at TEXT,
  deleted_at TEXT,
  CHECK (length(id) = 36),
  CHECK (length(asset_id) = 36),
  CHECK (length(title) BETWEEN 1 AND 100),
  CHECK (length(description) <= 5000),
  CHECK (visibility IN ('public', 'unlisted', 'followers', 'gated')),
  CHECK (kind IN ('normal', 'short')),
  CHECK (age_restricted IN (0, 1)),
  CHECK (comments_enabled IN (0, 1)),
  CHECK (state IN ('upload_issued', 'processing', 'ready', 'published', 'unpublished', 'rejected', 'failed', 'deleted')),
  CHECK (hold_reason IS NULL OR hold_reason IN ('copyright')),
  CHECK (source IN ('desktop', 'web')),
  CHECK (max_height IN (720, 1080)),
  CHECK (processing_kind IS NULL OR processing_kind IN ('remux', 'remux_low', 'transcode')),
  CHECK (charged_kind IS NULL OR charged_kind IN ('remux', 'remux_low', 'transcode')),
  CHECK (declared_minutes BETWEEN 1 AND 60),
  CHECK (charged_minutes IS NULL OR charged_minutes >= 1),
  CHECK (upload_bytes > 0),
  CHECK (upload_committed IN (0, 1)),
  CHECK (upload_released IN (0, 1)),
  CHECK (stored_released IN (0, 1)),
  CHECK ((charged_minutes IS NULL) = (charged_at IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_hub_videos_owner ON hub_videos(profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hub_videos_open
  ON hub_videos(profile_id, state) WHERE state IN ('upload_issued', 'processing');
CREATE INDEX IF NOT EXISTS idx_hub_videos_charged
  ON hub_videos(profile_id, charged_at) WHERE charged_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_hub_videos_external
  ON hub_videos(external_video_id) WHERE external_video_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_hub_videos_published
  ON hub_videos(visibility, published_at DESC) WHERE state = 'published';

-- Work that must reach the Video Worker or Account after Hub has already decided. A row means
-- "Hub has changed its own state; tell the other side". Retried by the maintenance job; every
-- attempt signs a fresh ticket or claim, so retrying is always safe.
--   unpublish / delete : send the matching state change to the Video Worker
--   storage            : read its status and finish the Account steps
CREATE TABLE IF NOT EXISTS hub_video_outbox (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL REFERENCES hub_videos(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (video_id, kind),
  CHECK (kind IN ('unpublish', 'delete', 'storage')),
  CHECK (attempts >= 0)
);

CREATE INDEX IF NOT EXISTS idx_hub_video_outbox_due ON hub_video_outbox(next_attempt_at);
