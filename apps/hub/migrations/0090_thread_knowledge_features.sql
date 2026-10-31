CREATE TABLE IF NOT EXISTS thread_workflow_states (
  thread_id TEXT PRIMARY KEY REFERENCES threads(id) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK(state IN ('open','answered','resolved','verification','update_needed','closed')) DEFAULT 'open',
  updated_by_profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS thread_post_knowledge (
  post_id TEXT PRIMARY KEY REFERENCES thread_posts(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('unspecified','answer','context','counterpoint','question','correction','source')) DEFAULT 'unspecified',
  supersedes_post_id TEXT REFERENCES thread_posts(id) ON DELETE SET NULL,
  freshness TEXT NOT NULL CHECK(freshness IN ('current','possibly_outdated','outdated')) DEFAULT 'current',
  sources_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS thread_vote_reasons (
  post_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK(reason IN ('incorrect','unsupported','off_topic','unclear')),
  created_at TEXT NOT NULL,
  PRIMARY KEY(post_id,profile_id),
  FOREIGN KEY(post_id,profile_id) REFERENCES thread_post_votes(post_id,profile_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS thread_relations (
  source_thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  target_thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  relation TEXT NOT NULL CHECK(relation IN ('related','duplicate','continuation','merged')),
  created_by_profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(source_thread_id,target_thread_id),
  CHECK(source_thread_id<>target_thread_id)
);
CREATE INDEX IF NOT EXISTS idx_thread_post_knowledge_role ON thread_post_knowledge(role,freshness);
CREATE INDEX IF NOT EXISTS idx_thread_relations_target ON thread_relations(target_thread_id,relation);
