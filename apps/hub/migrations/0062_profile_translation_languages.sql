PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS profile_translation_language_preferences (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  source_language TEXT NOT NULL,
  enabled INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (profile_id, source_language),
  CHECK (source_language IN ('ja', 'en', 'ko', 'zh-CN', 'other')),
  CHECK (enabled IN (0, 1))
);

