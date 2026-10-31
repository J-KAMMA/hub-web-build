CREATE TABLE IF NOT EXISTS hubpedia_encyclopedia_benchmarks (
  article_slug TEXT NOT NULL,
  provider TEXT NOT NULL,
  article_url TEXT NOT NULL,
  revision_key TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  concepts_json TEXT NOT NULL DEFAULT '[]',
  coverage_ratio REAL,
  missing_concepts_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL CHECK (status IN ('needs-work', 'meets-baseline', 'adds-value')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (article_slug, provider)
);

CREATE INDEX IF NOT EXISTS hubpedia_encyclopedia_benchmarks_status_idx
  ON hubpedia_encyclopedia_benchmarks(status, checked_at);
