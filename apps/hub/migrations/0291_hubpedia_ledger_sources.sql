-- Hubpedia ledger, lane A (sources, stages S1-S3). See docs/hubpedia-ledger.md section 2 and 8.
--
-- The ledger reads sources before it knows which topic they serve, so its sources and (later) its
-- claims belong to one dedicated, archived pool topic. The real topic of a claim is kept in the
-- ledger assignment table, not in these columns. Queries that list or schedule topics exclude
-- topic_type = 'ledger-pool'.
INSERT OR IGNORE INTO encyclopedia_topics
  (id, canonical_name, slug, description, topic_type, status, freshness_interval_hours, created_at, updated_at)
VALUES
  ('ledger-pool', '_ledger', '_ledger',
   'Holding topic for ledger sources and claims. Never an article subject.',
   'ledger-pool', 'archived', 720, unixepoch(), unixepoch());

-- Hash of the chunk text. Stable across re-runs, so an unchanged chunk keeps its claims when a
-- source is fetched again.
ALTER TABLE encyclopedia_source_chunks ADD COLUMN content_hash TEXT;
CREATE INDEX IF NOT EXISTS encyclopedia_source_chunks_content_hash_idx
  ON encyclopedia_source_chunks (content_hash);

-- Set when the snapshot an evidence row quotes has been replaced and the quote was not found again.
-- NULL means the evidence is live.
ALTER TABLE encyclopedia_claim_evidence ADD COLUMN superseded_at INTEGER;

-- Which feed brought the source in, and when it is due to be fetched again.
ALTER TABLE encyclopedia_sources ADD COLUMN feed_id TEXT;
ALTER TABLE encyclopedia_sources ADD COLUMN next_check_at INTEGER;
CREATE INDEX IF NOT EXISTS encyclopedia_sources_feed_due_idx
  ON encyclopedia_sources (feed_id, next_check_at);

-- Keyset cursor of each feed's discovery (stage S1). Empty string means "from the start".
CREATE TABLE IF NOT EXISTS hubpedia_ledger_feed_cursors (
  feed_id TEXT PRIMARY KEY,
  cursor TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);

-- Source bodies are not stored in D1 (owner decision 2026-10-29). The normalized page text of each
-- snapshot is an immutable R2 object keyed by its SHA-256 (hubpedia-ledger/snapshots/<sha256>.txt, binding
-- HUB_LEDGER_SOURCES). D1 keeps only where it is, its hash and its length; the licence is on
-- encyclopedia_sources and the fetch time is retrieved_at. extracted_text stays NULL for ledger snapshots.
-- A ledger chunk keeps start_offset / end_offset (into that body) and content_hash, and writes '' to
-- text_content (a NOT NULL column from 0002 that SQLite cannot relax without rebuilding the table, which other
-- Hubpedia paths still use for their own chunks). Readers slice the verified body and re-check content_hash.
ALTER TABLE encyclopedia_source_snapshots ADD COLUMN body_object_key TEXT;
ALTER TABLE encyclopedia_source_snapshots ADD COLUMN body_sha256 TEXT;
ALTER TABLE encyclopedia_source_snapshots ADD COLUMN body_bytes INTEGER;
