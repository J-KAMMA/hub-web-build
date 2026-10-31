-- Public metadata registry for resources whose bodies stay on owner-operated nodes.
-- Hub stores discovery metadata only. Payment, KYC, private messages, moderation
-- decisions, and audit records remain with their existing authoritative services.
CREATE TABLE IF NOT EXISTS distributed_resource_manifests (
  id TEXT PRIMARY KEY,
  canonical_resource_id TEXT NOT NULL UNIQUE,
  manifest_url TEXT NOT NULL UNIQUE,
  resource_kind TEXT NOT NULL,
  origin TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  language TEXT,
  published_at TEXT,
  preview_url TEXT,
  license TEXT NOT NULL,
  cache_policy TEXT NOT NULL DEFAULT 'denied',
  mirror_policy TEXT NOT NULL DEFAULT 'denied',
  ai_training_policy TEXT NOT NULL DEFAULT 'denied',
  commerce_mode TEXT NOT NULL DEFAULT 'none',
  content_hash TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]',
  capabilities_json TEXT NOT NULL DEFAULT '[]',
  mirrors_json TEXT NOT NULL DEFAULT '[]',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  submitted_by_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  verification_status TEXT NOT NULL DEFAULT 'pending',
  availability_status TEXT NOT NULL DEFAULT 'active',
  fetched_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (resource_kind IN ('post','thread','community','article','image','audio','file','product','catalog','compute','search','recommendation','logistics','storage')),
  CHECK (cache_policy IN ('denied','temporary','allowed')),
  CHECK (mirror_policy IN ('denied','allowed','required')),
  CHECK (ai_training_policy IN ('denied','allowed','attribution','consent-required')),
  CHECK (commerce_mode IN ('none','discovery-only','commerce-api')),
  CHECK (verification_status IN ('pending','verified','restricted','rejected')),
  CHECK (availability_status IN ('active','unavailable','removed')),
  CHECK (length(canonical_resource_id) BETWEEN 1 AND 2048),
  CHECK (length(manifest_url) BETWEEN 1 AND 2048),
  CHECK (length(origin) BETWEEN 1 AND 2048),
  CHECK (length(canonical_url) BETWEEN 1 AND 2048),
  CHECK (length(title) BETWEEN 1 AND 240),
  CHECK (length(summary) <= 5000),
  CHECK (language IS NULL OR length(language) <= 35),
  CHECK (preview_url IS NULL OR length(preview_url) <= 2048),
  CHECK (length(license) BETWEEN 1 AND 160)
);

CREATE INDEX IF NOT EXISTS distributed_resources_public
  ON distributed_resource_manifests(availability_status, verification_status, resource_kind, published_at DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS distributed_resources_origin
  ON distributed_resource_manifests(origin, availability_status, updated_at DESC);

CREATE TABLE IF NOT EXISTS distributed_provider_preferences (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  provider_kind TEXT NOT NULL,
  provider_resource_id TEXT REFERENCES distributed_resource_manifests(id) ON DELETE SET NULL,
  mode TEXT NOT NULL DEFAULT 'hub-standard',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (profile_id, provider_kind),
  CHECK (provider_kind IN ('search','recommendation','compute','storage')),
  CHECK (mode IN ('hub-standard','local','external')),
  CHECK ((mode = 'external' AND provider_resource_id IS NOT NULL) OR (mode != 'external' AND provider_resource_id IS NULL))
);
