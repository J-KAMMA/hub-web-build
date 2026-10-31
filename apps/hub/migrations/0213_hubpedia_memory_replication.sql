-- The research institution's peer-review record: explicit replication.
-- corroborates_proposal_id lets a proposal declare "I independently verified
-- this accepted entry" — distinct from the implicit claim-fingerprint match,
-- which only sees identically worded claims. A replication carries its own
-- evidence and goes through the same verification path as any submission.
ALTER TABLE hubpedia_memory_proposals ADD COLUMN corroborates_proposal_id TEXT REFERENCES hubpedia_memory_proposals(id);
CREATE INDEX IF NOT EXISTS idx_hubpedia_memory_corroborates
  ON hubpedia_memory_proposals(corroborates_proposal_id, status);
