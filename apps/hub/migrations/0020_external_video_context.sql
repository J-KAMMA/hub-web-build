PRAGMA foreign_keys = ON;

-- Discovery context gives Hub its own organizational value without copying video bodies.
-- Defaults keep existing catalog rows valid until their context is curated.
ALTER TABLE external_videos ADD COLUMN purpose TEXT NOT NULL DEFAULT 'other'
  CHECK (purpose IN ('guide', 'explanation', 'live', 'review', 'creation', 'music', 'other'));

ALTER TABLE external_videos ADD COLUMN topic TEXT NOT NULL DEFAULT '未分類'
  CHECK (length(topic) BETWEEN 1 AND 80);

ALTER TABLE external_videos ADD COLUMN related_hubpedia_slug TEXT
  CHECK (
    related_hubpedia_slug IS NULL OR (
      length(related_hubpedia_slug) BETWEEN 1 AND 160
      AND related_hubpedia_slug = lower(related_hubpedia_slug)
      AND related_hubpedia_slug NOT GLOB '*[^a-z0-9-]*'
      AND related_hubpedia_slug NOT LIKE '-%'
      AND related_hubpedia_slug NOT LIKE '%-'
      AND related_hubpedia_slug NOT LIKE '%--%'
    )
  );

CREATE INDEX IF NOT EXISTS idx_external_videos_discovery
  ON external_videos(status, purpose, topic, published_at DESC);

CREATE INDEX IF NOT EXISTS idx_external_videos_hubpedia
  ON external_videos(related_hubpedia_slug, status, published_at DESC)
  WHERE related_hubpedia_slug IS NOT NULL;
