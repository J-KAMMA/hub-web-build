ALTER TABLE content_tag_links ADD COLUMN tag_kind TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE content_tag_links ADD COLUMN confidence REAL NOT NULL DEFAULT 1 CHECK(confidence >= 0 AND confidence <= 1);
ALTER TABLE content_tag_links ADD COLUMN provenance TEXT NOT NULL DEFAULT 'publisher';
ALTER TABLE content_tag_links ADD COLUMN generation_basis TEXT NOT NULL DEFAULT 'legacy-tag';
ALTER TABLE content_tag_links ADD COLUMN classifier_version TEXT NOT NULL DEFAULT 'legacy';

CREATE INDEX IF NOT EXISTS idx_content_tag_links_signal
  ON content_tag_links(target_type, target_id, confidence DESC, tag_kind);
