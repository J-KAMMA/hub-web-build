CREATE TABLE research_links (
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('article','video','hubpedia','thread','community')),
  target_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(project_id,kind,target_id)
);
CREATE INDEX research_links_target ON research_links(kind,target_id);

CREATE TABLE research_documents (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 240),
  kind TEXT NOT NULL CHECK(kind IN ('paper','software','dataset','notebook')),
  visibility TEXT NOT NULL CHECK(visibility IN ('public','confidential')),
  head INTEGER NOT NULL DEFAULT 1 CHECK(head >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX research_documents_project ON research_documents(project_id,updated_at DESC);
CREATE TABLE research_document_revisions (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES research_documents(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK(version >= 1),
  body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 100000),
  content_hash TEXT NOT NULL,
  summary TEXT NOT NULL CHECK(length(summary) BETWEEN 1 AND 500),
  author_profile_id TEXT NOT NULL REFERENCES profiles(id),
  created_at TEXT NOT NULL,
  UNIQUE(document_id,version)
);
CREATE TABLE research_change_proposals (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES research_documents(id) ON DELETE CASCADE,
  base_version INTEGER NOT NULL,
  body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 100000),
  summary TEXT NOT NULL CHECK(length(summary) BETWEEN 1 AND 500),
  author_profile_id TEXT NOT NULL REFERENCES profiles(id),
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','accepted','rejected')),
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  FOREIGN KEY(document_id,base_version) REFERENCES research_document_revisions(document_id,version)
);
CREATE INDEX research_change_proposals_document ON research_change_proposals(document_id,status,created_at DESC);
