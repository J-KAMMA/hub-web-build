PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS research_projects (
  id TEXT PRIMARY KEY,
  owner_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 3 AND 240),
  description TEXT NOT NULL CHECK (length(description) <= 5000),
  status TEXT NOT NULL CHECK (status IN ('draft','active','paused','completed','withdrawn')),
  visibility TEXT NOT NULL CHECK (visibility IN ('public','embargoed','controlled','confidential','restricted')),
  default_license TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_research_projects_public
  ON research_projects(visibility, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS research_objects (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  created_by_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  object_type TEXT NOT NULL CHECK (object_type IN (
    'question','hypothesis','protocol','preregistration','experiment_run','dataset',
    'software','model','notebook','claim','evidence','review','replication','paper','license'
  )),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 240),
  version INTEGER NOT NULL CHECK (version >= 1),
  content_hash TEXT NOT NULL CHECK (content_hash GLOB 'sha256:*'),
  license TEXT,
  visibility TEXT NOT NULL CHECK (visibility IN ('public','embargoed','controlled','confidential','restricted')),
  supersedes_object_id TEXT REFERENCES research_objects(id) ON DELETE SET NULL,
  review_status TEXT NOT NULL DEFAULT 'unreviewed'
    CHECK (review_status IN ('unreviewed','in_review','changes_requested','accepted','rejected','withdrawn')),
  reproducibility_status TEXT NOT NULL DEFAULT 'not_attempted'
    CHECK (reproducibility_status IN (
      'not_attempted','queued','in_progress','reproduced_same_team',
      'replicated_independent_team','partially_replicated','failed_to_replicate',
      'inconclusive','methodologically_invalid'
    )),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, object_type, title, version)
);

CREATE INDEX IF NOT EXISTS idx_research_objects_project
  ON research_objects(project_id, object_type, updated_at DESC);

CREATE TABLE IF NOT EXISTS research_object_relations (
  from_object_id TEXT NOT NULL REFERENCES research_objects(id) ON DELETE CASCADE,
  to_object_id TEXT NOT NULL REFERENCES research_objects(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL CHECK (relation_type IN (
    'supported_by','contradicted_by','replicated_by','supersedes','derived_from',
    'uses_protocol','included_in','reviewed_by'
  )),
  created_at TEXT NOT NULL,
  PRIMARY KEY(from_object_id, to_object_id, relation_type),
  CHECK(from_object_id <> to_object_id)
);

CREATE TABLE IF NOT EXISTS research_contributions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  object_id TEXT REFERENCES research_objects(id) ON DELETE CASCADE,
  contributor_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  credit_role TEXT NOT NULL CHECK (credit_role IN (
    'conceptualization','methodology','software','data_curation','investigation',
    'formal_analysis','validation','visualization','funding_acquisition',
    'project_administration','writing','supervision','resources'
  )),
  contribution_mode TEXT NOT NULL CHECK (contribution_mode IN (
    'human','ai_assisted','ai_generated','ai_verified','human_approved'
  )),
  statement TEXT NOT NULL CHECK (length(statement) BETWEEN 1 AND 2000),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS research_provenance_events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  object_id TEXT REFERENCES research_objects(id) ON DELETE CASCADE,
  actor_profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  activity_type TEXT NOT NULL,
  input_object_ids_json TEXT NOT NULL DEFAULT '[]',
  output_hash TEXT,
  agent_metadata_json TEXT,
  occurred_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_research_provenance_project
  ON research_provenance_events(project_id, occurred_at DESC);
