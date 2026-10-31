-- Hubpedia ledger, Lane E: term net (docs/hubpedia-ledger.md sections 8 and 11).
-- File only. Nothing applies this until the owner approves a D1 write.
-- Aliases are not stored in D1; linking reads the snapshot file.

CREATE TABLE hubpedia_term_snapshots (
  id TEXT PRIMARY KEY,
  sha256 TEXT NOT NULL UNIQUE,
  retrieved_at TEXT NOT NULL,
  term_count INTEGER NOT NULL,
  edge_count INTEGER NOT NULL,
  params_json TEXT NOT NULL DEFAULT '{}',
  loaded_at INTEGER NOT NULL,
  -- The snapshot file itself is an immutable R2 object keyed by sha256 (hubpedia-ledger/term-net/<sha256>.jsonl).
  object_key TEXT,
  bytes INTEGER
);

CREATE TABLE hubpedia_terms (
  id TEXT PRIMARY KEY,
  qid TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  label_ja TEXT,
  label_en TEXT,
  topic_id TEXT REFERENCES encyclopedia_topics(id) ON DELETE SET NULL,
  hops INTEGER NOT NULL DEFAULT 0,
  sitelinks INTEGER NOT NULL DEFAULT 0,
  centrality REAL NOT NULL DEFAULT 0,
  demand REAL NOT NULL DEFAULT 0,
  priority_rank INTEGER,
  linkable INTEGER NOT NULL DEFAULT 1 CHECK (linkable IN (0, 1)),
  snapshot_id TEXT NOT NULL REFERENCES hubpedia_term_snapshots(id),
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX hubpedia_terms_topic_uidx ON hubpedia_terms(topic_id) WHERE topic_id IS NOT NULL;
CREATE INDEX hubpedia_terms_priority_idx ON hubpedia_terms(priority_rank, topic_id);

CREATE TABLE hubpedia_term_edges (
  from_term_id TEXT NOT NULL REFERENCES hubpedia_terms(id) ON DELETE CASCADE,
  to_term_id TEXT NOT NULL REFERENCES hubpedia_terms(id) ON DELETE CASCADE,
  relation TEXT NOT NULL
    CHECK (relation IN ('subclass_of','instance_of','part_of','facet_of','studies','related')),
  origin TEXT NOT NULL CHECK (origin IN ('wikidata','hub')),
  snapshot_id TEXT NOT NULL REFERENCES hubpedia_term_snapshots(id),
  PRIMARY KEY (from_term_id, to_term_id, relation)
);
CREATE INDEX hubpedia_term_edges_to_idx ON hubpedia_term_edges(to_term_id, relation);

CREATE TABLE hubpedia_term_link_cursor (
  snapshot_id TEXT NOT NULL REFERENCES hubpedia_term_snapshots(id),
  linker_version TEXT NOT NULL,
  last_claim_id TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (snapshot_id, linker_version)
);
