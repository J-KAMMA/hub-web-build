-- The commons layer: corroboration and supersession for shared memory.
-- claim_fingerprint identifies "the same claim" across independent submissions
-- (same kind/title/content/target, ignoring which sources were cited — a
-- corroboration with a different source is stronger evidence, not a duplicate).
-- corrects_proposal_id lets a correction name the entry it replaces;
-- superseded_by records that succession on the replaced entry.
ALTER TABLE hubpedia_memory_proposals ADD COLUMN claim_fingerprint TEXT;
ALTER TABLE hubpedia_memory_proposals ADD COLUMN corrects_proposal_id TEXT REFERENCES hubpedia_memory_proposals(id);
ALTER TABLE hubpedia_memory_proposals ADD COLUMN superseded_by TEXT REFERENCES hubpedia_memory_proposals(id);
CREATE INDEX IF NOT EXISTS idx_hubpedia_memory_claim_fp
  ON hubpedia_memory_proposals(claim_fingerprint, status);
