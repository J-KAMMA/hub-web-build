CREATE TABLE research_proposal_discussions (
  id TEXT PRIMARY KEY NOT NULL,
  proposal_id TEXT NOT NULL REFERENCES research_change_proposals(id) ON DELETE CASCADE,
  thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE RESTRICT,
  creator_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  removed_at TEXT,
  UNIQUE(proposal_id,thread_id)
);
CREATE TABLE research_proposal_discussion_requests (
  request_id TEXT PRIMARY KEY NOT NULL,
  proposal_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  creator_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  expected_link_id TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(proposal_id,thread_id) REFERENCES research_proposal_discussions(proposal_id,thread_id) ON DELETE CASCADE
);
