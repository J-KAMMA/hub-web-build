ALTER TABLE communities
  ADD COLUMN governance_mode TEXT NOT NULL DEFAULT 'standard'
  CHECK (governance_mode IN ('standard', 'dao'));

ALTER TABLE communities
  ADD COLUMN governance_voting_strategy TEXT NOT NULL DEFAULT 'one_member_one_vote'
  CHECK (
    governance_voting_strategy IN (
      'one_member_one_vote',
      'token_weighted',
      'token_capped'
    )
  );

ALTER TABLE communities
  ADD COLUMN governance_token_id TEXT;

ALTER TABLE communities
  ADD COLUMN governance_tokens_per_vote REAL NOT NULL DEFAULT 1
  CHECK (governance_tokens_per_vote > 0);

ALTER TABLE communities
  ADD COLUMN governance_vote_cap INTEGER CHECK (
    governance_vote_cap IS NULL OR governance_vote_cap >= 1
  );

CREATE TABLE IF NOT EXISTS community_governance_proposals (
  id TEXT PRIMARY KEY,
  community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  author_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('guide', 'channel', 'rule', 'moderator')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('discussion', 'voting', 'passed', 'rejected', 'executed', 'cancelled')
  ),
  voting_strategy TEXT NOT NULL CHECK (
    voting_strategy IN ('one_member_one_vote', 'token_weighted', 'token_capped')
  ),
  governance_token_id TEXT REFERENCES community_tokens(id) ON DELETE SET NULL,
  governance_token_symbol TEXT,
  tokens_per_vote REAL NOT NULL DEFAULT 1 CHECK (tokens_per_vote > 0),
  vote_weight_cap INTEGER CHECK (
    vote_weight_cap IS NULL OR vote_weight_cap >= 1
  ),
  quorum INTEGER NOT NULL CHECK (quorum >= 1),
  approval_threshold REAL NOT NULL CHECK (
    approval_threshold > 0 AND approval_threshold <= 1
  ),
  linked_guide_proposal_id TEXT REFERENCES community_guide_proposals(id) ON DELETE SET NULL,
  voting_starts_at TEXT NOT NULL,
  voting_ends_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  executed_at TEXT
);

CREATE TABLE IF NOT EXISTS community_governance_votes (
  proposal_id TEXT NOT NULL REFERENCES community_governance_proposals(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  choice TEXT NOT NULL CHECK (choice IN ('for', 'against', 'abstain')),
  weight INTEGER NOT NULL DEFAULT 1 CHECK (weight >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (proposal_id, profile_id)
);

CREATE INDEX IF NOT EXISTS idx_community_governance_proposals_status
  ON community_governance_proposals(community_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_community_governance_votes_proposal
  ON community_governance_votes(proposal_id, choice);

UPDATE communities
SET governance_mode = 'dao'
WHERE id = 'community-fallout4';
