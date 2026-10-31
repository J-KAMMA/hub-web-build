-- Copyright cases for Hub self-made videos (docs/hub-video/PLAN.md 5.2, lane V8; AGENTS.md 2026-10-15).
--
-- 1. copyright_case_targets: target_kind gets 'video', a native Hub video (hub_videos.id). Music and
--    Vault targets keep their kinds, and video_embed (an external platform's embed) is unchanged.
--    SQLite cannot change a CHECK in place, so the table is rebuilt the way 0268 did it: the new
--    table is built under a temporary name, filled, swapped in for the old one, and renamed. The
--    child tables (copyright_case_responses, copyright_case_events) keep referencing the name
--    copyright_case_targets. Every column, index and constraint is unchanged except the kind list.
--    REHEARSE on a copy of production first: both children must keep their row counts.
-- 2. hub_video_outbox: kind gets 'suspend', 'unsuspend' and 'takedown'. A copyright hold suspends the
--    video at the Video Worker (restore: unsuspend); a confirmed takedown deletes it there and tells
--    the Worker to keep the block row (kind 'takedown'). Hub changes its own row first; an item here
--    means "tell the Video Worker".
PRAGMA foreign_keys = OFF;
PRAGMA defer_foreign_keys = ON;

CREATE TABLE copyright_case_targets_video_new (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES copyright_cases(id) ON DELETE CASCADE,
  service TEXT NOT NULL DEFAULT 'hub' CHECK (service IN ('hub','music','vault')),
  target_kind TEXT NOT NULL CHECK (target_kind IN
    ('social_post','social_image','article','hubpedia_revision','video_embed','video','music_track','vault_content')),
  target_id TEXT NOT NULL,
  author_profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  state TEXT NOT NULL DEFAULT 'received' CHECK (state IN
    ('received','inquiry','objected','hidden','final','restored','kept','rejected')),
  inquiry_notified_at TEXT,
  inquiry_deadline_at TEXT,
  hidden_at TEXT,
  final_at TEXT,
  restored_at TEXT,
  closed_at TEXT,
  objection_open INTEGER NOT NULL DEFAULT 0 CHECK (objection_open IN (0,1)),
  restore_data TEXT CHECK (restore_data IS NULL OR (json_valid(restore_data) AND length(restore_data) <= 1000)),
  pending_action TEXT CHECK (pending_action IS NULL OR pending_action IN ('open','hide','object','restore','finalize','close')),
  pending_params TEXT CHECK (pending_params IS NULL OR (json_valid(pending_params) AND length(pending_params) <= 1000)),
  service_synced_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  clearly_infringing INTEGER NOT NULL DEFAULT 0 CHECK (clearly_infringing IN (0,1)),
  needs_decision_at TEXT,
  UNIQUE (case_id, target_kind, target_id),
  CHECK ((service = 'hub') = (target_kind NOT IN ('music_track','vault_content'))),
  CHECK (length(target_id) BETWEEN 1 AND 200),
  CHECK (state <> 'inquiry' OR inquiry_deadline_at IS NOT NULL)
);

INSERT INTO copyright_case_targets_video_new (
  id, case_id, service, target_kind, target_id, author_profile_id, state,
  inquiry_notified_at, inquiry_deadline_at, hidden_at, final_at, restored_at, closed_at,
  objection_open, restore_data, pending_action, pending_params, service_synced_at,
  created_at, updated_at, clearly_infringing, needs_decision_at
)
SELECT
  id, case_id, service, target_kind, target_id, author_profile_id, state,
  inquiry_notified_at, inquiry_deadline_at, hidden_at, final_at, restored_at, closed_at,
  objection_open, restore_data, pending_action, pending_params, service_synced_at,
  created_at, updated_at, clearly_infringing, needs_decision_at
FROM copyright_case_targets;

DROP TABLE copyright_case_targets;
ALTER TABLE copyright_case_targets_video_new RENAME TO copyright_case_targets;

CREATE INDEX idx_copyright_case_targets_inquiry_due
  ON copyright_case_targets(inquiry_deadline_at) WHERE state = 'inquiry';
CREATE INDEX idx_copyright_case_targets_hidden_due
  ON copyright_case_targets(hidden_at) WHERE state = 'hidden' AND objection_open = 0;
CREATE INDEX idx_copyright_case_targets_target
  ON copyright_case_targets(target_kind, target_id, state);
CREATE INDEX idx_copyright_case_targets_pending
  ON copyright_case_targets(updated_at) WHERE pending_action IS NOT NULL;
CREATE INDEX idx_copyright_case_targets_case
  ON copyright_case_targets(case_id);
CREATE INDEX idx_copyright_case_targets_queue
  ON copyright_case_targets(state, created_at DESC);
CREATE INDEX idx_copyright_case_targets_author
  ON copyright_case_targets(author_profile_id, created_at DESC) WHERE author_profile_id IS NOT NULL;
CREATE INDEX idx_copyright_case_targets_needs_decision
  ON copyright_case_targets(needs_decision_at) WHERE state = 'inquiry' AND needs_decision_at IS NOT NULL;

CREATE TABLE hub_video_outbox_copyright_new (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL REFERENCES hub_videos(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (video_id, kind),
  CHECK (kind IN ('unpublish', 'delete', 'storage', 'suspend', 'unsuspend', 'takedown')),
  CHECK (attempts >= 0)
);

INSERT INTO hub_video_outbox_copyright_new (id, video_id, kind, attempts, next_attempt_at, created_at)
SELECT id, video_id, kind, attempts, next_attempt_at, created_at FROM hub_video_outbox;

DROP TABLE hub_video_outbox;
ALTER TABLE hub_video_outbox_copyright_new RENAME TO hub_video_outbox;

CREATE INDEX idx_hub_video_outbox_due ON hub_video_outbox(next_attempt_at);

PRAGMA defer_foreign_keys = OFF;
PRAGMA foreign_keys = ON;
