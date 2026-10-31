PRAGMA foreign_keys = ON;

-- Public discovery metadata only. Tags must not contain sensitive identity or
-- cross-service account identifiers.
ALTER TABLE threads ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(tags_json) AND json_type(tags_json) = 'array');
