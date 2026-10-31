CREATE TABLE research_links_with_music (
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('article','video','music','hubpedia','thread','community')),
  target_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(project_id,kind,target_id)
);
INSERT INTO research_links_with_music(project_id,kind,target_id,created_at)
  SELECT project_id,kind,target_id,created_at FROM research_links;
DROP TABLE research_links;
ALTER TABLE research_links_with_music RENAME TO research_links;
CREATE INDEX research_links_target ON research_links(kind,target_id);
