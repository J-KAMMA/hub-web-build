CREATE TABLE research_git_proposals (
  id TEXT NOT NULL PRIMARY KEY CHECK(length(id)=36),
  project_id TEXT NOT NULL REFERENCES research_git_repositories(project_id) ON DELETE CASCADE,
  base_oid TEXT NOT NULL CHECK(length(base_oid) IN (40,64) AND base_oid NOT GLOB '*[^0-9a-f]*'),
  head_oid TEXT NOT NULL CHECK(length(head_oid)=length(base_oid) AND head_oid NOT GLOB '*[^0-9a-f]*' AND head_oid<>base_oid),
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 240),
  summary TEXT NOT NULL CHECK(length(summary) BETWEEN 1 AND 500),
  source_hash TEXT NOT NULL CHECK(length(source_hash)=64 AND source_hash NOT GLOB '*[^0-9a-f]*'),
  author_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','approved','rejected')),
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  reviewer_profile_id TEXT REFERENCES profiles(id) ON DELETE RESTRICT,
  decision_snapshot TEXT,
  comparison_hash TEXT,
  CHECK((status='open' AND resolved_at IS NULL AND reviewer_profile_id IS NULL AND decision_snapshot IS NULL AND comparison_hash IS NULL)
    OR (status='rejected' AND resolved_at IS NOT NULL AND reviewer_profile_id IS NOT NULL AND decision_snapshot IS NOT NULL AND length(decision_snapshot)=64 AND decision_snapshot NOT GLOB '*[^0-9a-f]*' AND comparison_hash IS NULL)
    OR (status='approved' AND resolved_at IS NOT NULL AND reviewer_profile_id IS NOT NULL AND decision_snapshot IS NOT NULL AND length(decision_snapshot)=64 AND decision_snapshot NOT GLOB '*[^0-9a-f]*' AND comparison_hash IS NOT NULL AND length(comparison_hash)=64 AND comparison_hash NOT GLOB '*[^0-9a-f]*'))
);
CREATE INDEX research_git_proposals_project ON research_git_proposals(project_id,created_at DESC,id DESC);
CREATE INDEX research_git_proposals_author ON research_git_proposals(author_profile_id,created_at);
