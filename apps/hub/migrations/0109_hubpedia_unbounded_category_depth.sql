-- Parent relationships are the canonical hierarchy. This unbounded depth
-- column replaces the original bounded display hint without rebuilding the
-- referenced category table.
ALTER TABLE hubpedia_categories
  ADD COLUMN hierarchy_depth INTEGER NOT NULL DEFAULT 0 CHECK (hierarchy_depth >= 0);

UPDATE hubpedia_categories SET hierarchy_depth = dynamic_depth;
