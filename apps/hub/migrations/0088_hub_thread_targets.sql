CREATE TABLE IF NOT EXISTS hub_thread_targets (
  thread_id TEXT PRIMARY KEY REFERENCES threads(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('standalone','hubpedia_article','video','music_work','community','shopping_review','game','region')),
  target_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (target_type, target_id)
);
CREATE INDEX IF NOT EXISTS idx_hub_thread_targets_lookup ON hub_thread_targets(target_type, target_id);
INSERT OR IGNORE INTO hub_thread_targets(thread_id, target_type, target_id, created_at)
SELECT id, 'standalone', id, created_at FROM threads;
