PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS community_governance_token_rules (
  community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  token_id TEXT NOT NULL REFERENCES community_tokens(id) ON DELETE CASCADE,
  tokens_per_vote REAL NOT NULL CHECK (tokens_per_vote > 0),
  weight REAL NOT NULL DEFAULT 1 CHECK (weight > 0),
  position INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0),
  PRIMARY KEY (community_id, token_id)
);

CREATE TABLE IF NOT EXISTS community_governance_proposal_token_rules (
  proposal_id TEXT NOT NULL REFERENCES community_governance_proposals(id) ON DELETE CASCADE,
  token_id TEXT NOT NULL,
  token_symbol TEXT NOT NULL,
  tokens_per_vote REAL NOT NULL CHECK (tokens_per_vote > 0),
  weight REAL NOT NULL DEFAULT 1 CHECK (weight > 0),
  position INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0),
  PRIMARY KEY (proposal_id, token_id)
);

CREATE INDEX IF NOT EXISTS idx_community_governance_token_rules_community
  ON community_governance_token_rules(community_id, position);

CREATE INDEX IF NOT EXISTS idx_governance_proposal_token_rules_proposal
  ON community_governance_proposal_token_rules(proposal_id, position);

INSERT OR IGNORE INTO community_governance_token_rules (
  community_id, token_id, tokens_per_vote, weight, position
)
SELECT id, governance_token_id, governance_tokens_per_vote, 1, 0
FROM communities
WHERE governance_token_id IS NOT NULL;

INSERT OR IGNORE INTO community_governance_proposal_token_rules (
  proposal_id, token_id, token_symbol, tokens_per_vote, weight, position
)
SELECT id, governance_token_id, governance_token_symbol, tokens_per_vote, 1, 0
FROM community_governance_proposals
WHERE governance_token_id IS NOT NULL AND governance_token_symbol IS NOT NULL;
