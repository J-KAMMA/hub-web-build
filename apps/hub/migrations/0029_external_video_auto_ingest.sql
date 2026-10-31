-- Preserve anonymous posting when a public post contributes a catalog video.
ALTER TABLE external_videos ADD COLUMN submitter_visible INTEGER NOT NULL DEFAULT 1
  CHECK (submitter_visible IN (0, 1));

ALTER TABLE external_videos ADD COLUMN ingest_source TEXT NOT NULL DEFAULT 'manual'
  CHECK (ingest_source IN ('manual', 'social_post', 'thread', 'thread_reply'));
