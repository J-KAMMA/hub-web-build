CREATE TABLE IF NOT EXISTS thread_event_preferences(
  thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  replies INTEGER NOT NULL DEFAULT 1 CHECK(replies IN(0,1)),
  corrections INTEGER NOT NULL DEFAULT 1 CHECK(corrections IN(0,1)),
  best_answers INTEGER NOT NULL DEFAULT 1 CHECK(best_answers IN(0,1)),
  state_changes INTEGER NOT NULL DEFAULT 1 CHECK(state_changes IN(0,1)),
  summary_promotions INTEGER NOT NULL DEFAULT 1 CHECK(summary_promotions IN(0,1)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(thread_id,profile_id)
);
