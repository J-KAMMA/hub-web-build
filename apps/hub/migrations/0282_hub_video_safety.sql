-- Self-made video safety (docs/hub-video/PLAN.md sections 2.3, 5.1, 5.3; lane V9).
--
-- review_status: the first-videos operator review. A creator who does not yet have 3 approved (or
--   already-live) videos publishes into 'pending'; Hub keeps the row in state 'ready', so no play
--   ticket, no catalog row and no Video Worker publish happens until an operator approves.
--     none -> pending -> approved | rejected
-- safety_hold: set at once by a child-sexual-content report. Like a copyright hold it takes the
--   video down and the owner cannot lift it; only an operator can.
-- video_reports.reason_code: the structured report reason. The free-text `reason` column stays.
ALTER TABLE hub_videos ADD COLUMN review_status TEXT NOT NULL DEFAULT 'none'
  CHECK (review_status IN ('none', 'pending', 'approved', 'rejected'));
ALTER TABLE hub_videos ADD COLUMN review_requested_at TEXT;
ALTER TABLE hub_videos ADD COLUMN review_decided_at TEXT;
ALTER TABLE hub_videos ADD COLUMN safety_hold INTEGER NOT NULL DEFAULT 0
  CHECK (safety_hold IN (0, 1));
-- 1 when the hold took a LIVE video down: dismissing the report then puts it back.
ALTER TABLE hub_videos ADD COLUMN safety_hold_was_live INTEGER NOT NULL DEFAULT 0
  CHECK (safety_hold_was_live IN (0, 1));

CREATE INDEX IF NOT EXISTS idx_hub_videos_review_pending
  ON hub_videos(review_requested_at) WHERE review_status = 'pending';

ALTER TABLE video_reports ADD COLUMN reason_code TEXT;

CREATE INDEX IF NOT EXISTS idx_video_reports_open
  ON video_reports(created_at) WHERE status = 'open';
