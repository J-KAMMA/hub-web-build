PRAGMA foreign_keys = ON;

ALTER TABLE community_governance_proposals
  ADD COLUMN voting_method_v2 TEXT NOT NULL DEFAULT 'one_member_one_vote'
  CHECK (voting_method_v2 IN (
    'one_member_one_vote',
    'one_holder_one_vote',
    'token_linear',
    'token_sqrt',
    'token_log',
    'dual_chamber'
  ));

ALTER TABLE community_governance_proposals
  ADD COLUMN decision_scope TEXT NOT NULL DEFAULT 'community'
  CHECK (decision_scope IN ('community','budget','token','project','rules','moderation','hub_policy','security'));

ALTER TABLE community_governance_proposals
  ADD COLUMN execution_mode TEXT NOT NULL DEFAULT 'operator'
  CHECK (execution_mode IN ('advisory','operator','timelock','veto'));

ALTER TABLE community_governance_proposals
  ADD COLUMN snapshot_policy TEXT NOT NULL DEFAULT 'proposal_start'
  CHECK (snapshot_policy IN ('proposal_start','seven_day_prior','time_weighted'));

ALTER TABLE community_governance_proposals
  ADD COLUMN snapshot_block_number TEXT;

ALTER TABLE community_governance_proposals
  ADD COLUMN snapshot_captured_at TEXT;

ALTER TABLE community_governance_proposals
  ADD COLUMN quorum_member_bps INTEGER NOT NULL DEFAULT 2000
  CHECK (quorum_member_bps BETWEEN 0 AND 10000);

ALTER TABLE community_governance_proposals
  ADD COLUMN quorum_token_bps INTEGER NOT NULL DEFAULT 0
  CHECK (quorum_token_bps BETWEEN 0 AND 10000);

ALTER TABLE community_governance_proposals
  ADD COLUMN approval_bps INTEGER NOT NULL DEFAULT 5001
  CHECK (approval_bps BETWEEN 1 AND 10000);

ALTER TABLE community_governance_votes
  ADD COLUMN member_weight INTEGER NOT NULL DEFAULT 1 CHECK(member_weight IN (0,1));

ALTER TABLE community_governance_votes
  ADD COLUMN token_weight INTEGER NOT NULL DEFAULT 0 CHECK(token_weight >= 0);

CREATE INDEX IF NOT EXISTS idx_governance_proposals_method
  ON community_governance_proposals(community_id, voting_method_v2, status);
