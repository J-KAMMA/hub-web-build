PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS community_onboarding_questions (
  id TEXT PRIMARY KEY,
  community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  prompt TEXT NOT NULL CHECK(length(prompt) BETWEEN 1 AND 200),
  required INTEGER NOT NULL DEFAULT 1 CHECK(required IN (0,1)),
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS community_onboarding_answers (
  community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL REFERENCES community_onboarding_questions(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  answer TEXT NOT NULL CHECK(length(answer) BETWEEN 1 AND 1000),
  created_at TEXT NOT NULL,
  PRIMARY KEY(question_id, profile_id)
);

CREATE TABLE IF NOT EXISTS community_welcome_progress (
  community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  rules_read INTEGER NOT NULL DEFAULT 0 CHECK(rules_read IN (0,1)),
  channel_opened INTEGER NOT NULL DEFAULT 0 CHECK(channel_opened IN (0,1)),
  first_posted INTEGER NOT NULL DEFAULT 0 CHECK(first_posted IN (0,1)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(community_id, profile_id)
);

ALTER TABLE community_channels ADD COLUMN archived_at TEXT;
ALTER TABLE community_channels ADD COLUMN slowmode_seconds INTEGER NOT NULL DEFAULT 0
  CHECK(slowmode_seconds IN (0,5,10,30,60,300,600,3600));
ALTER TABLE community_channels ADD COLUMN token_gate_id TEXT REFERENCES community_tokens(id) ON DELETE SET NULL;
ALTER TABLE community_channels ADD COLUMN minimum_token_balance TEXT;

CREATE TABLE IF NOT EXISTS community_message_pins (
  community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL REFERENCES community_channels(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL REFERENCES community_channel_messages(id) ON DELETE CASCADE,
  pinned_by_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  pinned_at TEXT NOT NULL,
  PRIMARY KEY(channel_id, message_id)
);

CREATE TABLE IF NOT EXISTS community_moderation_appeals (
  id TEXT PRIMARY KEY,
  community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  member_action_id TEXT REFERENCES community_member_actions(id) ON DELETE SET NULL,
  reason TEXT NOT NULL CHECK(length(reason) BETWEEN 20 AND 1000),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','rejected','withdrawn')),
  reviewed_by_profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  resolution_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS community_duplicate_reports (
  id TEXT PRIMARY KEY,
  source_community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  target_community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  reporter_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK(length(reason) BETWEEN 10 AND 500),
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','confirmed','dismissed','merged')),
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  UNIQUE(source_community_id, target_community_id, reporter_profile_id)
);

CREATE TABLE IF NOT EXISTS community_role_auto_rules (
  id TEXT PRIMARY KEY,
  community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  role_id TEXT NOT NULL REFERENCES community_custom_roles(id) ON DELETE CASCADE,
  criterion TEXT NOT NULL CHECK(criterion IN ('membership_days','message_count','guide_contributions','token_balance')),
  threshold TEXT NOT NULL,
  token_id TEXT REFERENCES community_tokens(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS community_governance_delegations (
  community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  delegator_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  delegate_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY(community_id, delegator_profile_id),
  CHECK(delegator_profile_id != delegate_profile_id)
);

CREATE TABLE IF NOT EXISTS community_governance_vote_snapshots (
  proposal_id TEXT NOT NULL REFERENCES community_governance_proposals(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  voting_weight INTEGER NOT NULL CHECK(voting_weight >= 0),
  basis_json TEXT NOT NULL DEFAULT '{}',
  captured_at TEXT NOT NULL,
  PRIMARY KEY(proposal_id, profile_id)
);

CREATE TABLE IF NOT EXISTS community_guide_revisions (
  id TEXT PRIMARY KEY,
  community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  page_id TEXT NOT NULL REFERENCES community_guide_pages(id) ON DELETE CASCADE,
  proposal_id TEXT REFERENCES community_guide_proposals(id) ON DELETE SET NULL,
  editor_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  revision_no INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(page_id, revision_no)
);

CREATE INDEX IF NOT EXISTS idx_community_onboarding_questions ON community_onboarding_questions(community_id, position);
CREATE INDEX IF NOT EXISTS idx_community_pins ON community_message_pins(channel_id, pinned_at DESC);
CREATE INDEX IF NOT EXISTS idx_community_appeals_queue ON community_moderation_appeals(community_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_community_duplicates_queue ON community_duplicate_reports(status, created_at);
CREATE INDEX IF NOT EXISTS idx_community_guide_revisions ON community_guide_revisions(page_id, revision_no DESC);
