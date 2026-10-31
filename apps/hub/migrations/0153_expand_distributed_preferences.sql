PRAGMA foreign_keys = OFF;

ALTER TABLE distributed_provider_preferences RENAME TO distributed_provider_preferences_legacy;

CREATE TABLE distributed_provider_preferences (
  profile_id TEXT NOT NULL,
  provider_kind TEXT NOT NULL,
  provider_resource_id TEXT,
  mode TEXT NOT NULL DEFAULT 'hub-standard',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (profile_id, provider_kind),
  CHECK (provider_kind IN (
    'post','thread','community','article','image','audio','file',
    'product','catalog','compute','search','recommendation','logistics','storage'
  )),
  CHECK (mode IN ('hub-standard','local','external')),
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
  FOREIGN KEY (provider_resource_id) REFERENCES distributed_resource_manifests(id) ON DELETE SET NULL
);

INSERT INTO distributed_provider_preferences(profile_id, provider_kind, provider_resource_id, mode, updated_at)
SELECT profile_id, provider_kind, provider_resource_id, mode, updated_at
FROM distributed_provider_preferences_legacy;

DROP TABLE distributed_provider_preferences_legacy;

CREATE INDEX IF NOT EXISTS idx_distributed_preferences_provider
  ON distributed_provider_preferences(provider_resource_id, provider_kind);

PRAGMA foreign_keys = ON;
