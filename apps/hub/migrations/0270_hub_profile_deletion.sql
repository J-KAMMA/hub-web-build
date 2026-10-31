-- Profile deletion with a 30-day cancel window (owner decision 2026-10-17; docs/hub-privacy/AUDIT.md 2.1 and 7.2-1).
--
-- profiles cannot be deleted: 47 foreign keys RESTRICT it and other people's threads, DMs and
-- community messages point at it. So the row stays as a tombstone (deleted_at set, name, bio,
-- avatar and handle replaced) and everything personal around it is deleted or anonymized by a
-- resumable hourly job (lib/server/profile-deletion.ts).
--
-- hub_data_requests keeps its CHECK (no 'cancelled'); the schedule and the step cursor live in
-- hub_profile_deletions. Cancelling deletes the open hub_data_requests row, so the Hubpedia
-- reader (hubpedia-hub-evidence.ts) stops treating the author as "deletion requested".

ALTER TABLE profiles ADD COLUMN deleted_at TEXT;

CREATE TABLE IF NOT EXISTS hub_profile_deletions (
  request_id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  requested_at TEXT NOT NULL,
  -- requested_at + 30 days. The job does nothing before this instant; the user may cancel until then.
  execute_after TEXT NOT NULL,
  cancelled_at TEXT,
  -- Set once by the job when it claims the request. From then on the request can no longer be cancelled.
  started_at TEXT,
  completed_at TEXT,
  -- Cursor of the resumable execution: the step to run next (or "delete:<n>" inside the bulk step).
  step TEXT NOT NULL DEFAULT 'start',
  attempts INTEGER NOT NULL DEFAULT 0,
  -- First time the job waited for Account/Video/file-component outboxes to drain.
  waiting_since TEXT,
  updated_at TEXT NOT NULL,
  CHECK (execute_after > requested_at)
);

-- At most one live (not cancelled) deletion per profile.
CREATE UNIQUE INDEX IF NOT EXISTS idx_hub_profile_deletions_live
  ON hub_profile_deletions(profile_id) WHERE cancelled_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_hub_profile_deletions_due
  ON hub_profile_deletions(execute_after) WHERE cancelled_at IS NULL AND completed_at IS NULL;

-- Requests made before this migration were never processed. They get the same 30-day window,
-- counted from today, so nobody is deleted without a chance to cancel.
INSERT OR IGNORE INTO hub_profile_deletions (request_id, profile_id, requested_at, execute_after, updated_at)
SELECT id, profile_id, created_at,
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+30 days'),
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM hub_data_requests
WHERE request_type = 'deletion' AND status IN ('open', 'processing');

-- A tombstoned profile never gets a session again, whichever login route is used.
CREATE TRIGGER IF NOT EXISTS sessions_refuse_deleted_profile
BEFORE INSERT ON sessions
WHEN EXISTS (SELECT 1 FROM profiles WHERE id = NEW.profile_id AND deleted_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'profile_deleted');
END;

-- Indexes so that deleting one profile reads that profile's rows, not the whole table (D1 bills by
-- rows read). Only the large event-like tables; the guard test lists the small ones it accepts.
CREATE INDEX IF NOT EXISTS idx_video_likes_profile ON video_likes(profile_id);
CREATE INDEX IF NOT EXISTS idx_video_thread_comment_likes_profile ON video_thread_comment_likes(profile_id);
CREATE INDEX IF NOT EXISTS idx_community_channel_reactions_profile ON community_channel_reactions(profile_id);
CREATE INDEX IF NOT EXISTS idx_community_message_poll_votes_profile ON community_message_poll_votes(profile_id);
CREATE INDEX IF NOT EXISTS idx_thread_notification_events_receiver ON thread_notification_events(receiver_profile_id);
CREATE INDEX IF NOT EXISTS idx_thread_reading_archive_profile ON thread_reading_archive(profile_id);
CREATE INDEX IF NOT EXISTS idx_thread_post_quality_votes_profile ON thread_post_quality_votes(profile_id);
CREATE INDEX IF NOT EXISTS idx_shopping_review_reactions_profile ON shopping_review_reactions(profile_id);
CREATE INDEX IF NOT EXISTS idx_remote_reactions_profile ON remote_reactions(profile_id);
CREATE INDEX IF NOT EXISTS idx_social_scheduled_posts_author ON social_scheduled_posts(author_profile_id);
CREATE INDEX IF NOT EXISTS idx_classified_analytics_events_profile ON classified_analytics_events(profile_id);
