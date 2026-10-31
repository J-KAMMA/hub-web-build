-- Hubpedia ledger, Lane B (S4-S6): claim ledger. See docs/hubpedia-ledger.md section 3 and 8.
-- Local D1 only. The claim identity columns live on the existing claims table; sources and
-- chunks stay with Lane A (0291).

ALTER TABLE encyclopedia_claims ADD COLUMN claim_key TEXT;
ALTER TABLE encyclopedia_claims ADD COLUMN ledger_ref TEXT;
ALTER TABLE encyclopedia_claims ADD COLUMN merged_into_claim_id TEXT REFERENCES encyclopedia_claims(id);

CREATE UNIQUE INDEX encyclopedia_claims_claim_key_uidx
  ON encyclopedia_claims(claim_key) WHERE claim_key IS NOT NULL;
CREATE UNIQUE INDEX encyclopedia_claims_ledger_ref_uidx
  ON encyclopedia_claims(ledger_ref) WHERE ledger_ref IS NOT NULL;
CREATE INDEX encyclopedia_claims_merged_into_idx
  ON encyclopedia_claims(merged_into_claim_id) WHERE merged_into_claim_id IS NOT NULL;

-- One row per (chunk text, prompt version). Empty and failed results are recorded and retried;
-- they are never silently accepted as "no claims".
CREATE TABLE hubpedia_ledger_extractions (
  chunk_hash TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  chunk_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','skipped','succeeded','empty','failed','exhausted')),
  density_score REAL,
  raw_claims INTEGER NOT NULL DEFAULT 0,
  verified_claims INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  served_by TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (chunk_hash, prompt_version)
);
CREATE INDEX hubpedia_ledger_extractions_status_idx ON hubpedia_ledger_extractions(status, chunk_hash);
CREATE INDEX hubpedia_ledger_extractions_source_idx ON hubpedia_ledger_extractions(source_id, status);

CREATE TABLE hubpedia_ledger_claim_topics (
  claim_id TEXT NOT NULL REFERENCES encyclopedia_claims(id) ON DELETE CASCADE,
  topic_id TEXT NOT NULL REFERENCES encyclopedia_topics(id) ON DELETE CASCADE,
  relevance REAL,
  assigned_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (claim_id, topic_id)
);
CREATE INDEX hubpedia_ledger_claim_topics_topic_idx ON hubpedia_ledger_claim_topics(topic_id, claim_id);

CREATE TABLE hubpedia_ledger_topic_stats (
  topic_id TEXT PRIMARY KEY REFERENCES encyclopedia_topics(id) ON DELETE CASCADE,
  usable_claims INTEGER NOT NULL DEFAULT 0,
  usable_sources INTEGER NOT NULL DEFAULT 0,
  eligible INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE INDEX hubpedia_ledger_topic_stats_eligible_idx ON hubpedia_ledger_topic_stats(eligible, topic_id);
