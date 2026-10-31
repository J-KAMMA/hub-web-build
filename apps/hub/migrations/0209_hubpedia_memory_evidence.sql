-- Machine-verifiable provenance for agent memory proposals. A claim proposal
-- may carry the verbatim quote it rests on; when every cited source is on a
-- reviewed trusted domain and the quote is found in the fetched page text, the
-- proposal is auto-accepted and marked machine_verified. Everything else keeps
-- the human review path.
ALTER TABLE hubpedia_memory_proposals ADD COLUMN evidence_quote TEXT;
ALTER TABLE hubpedia_memory_proposals ADD COLUMN evidence_status TEXT NOT NULL DEFAULT 'unverified_proposal';
ALTER TABLE hubpedia_memory_proposals ADD COLUMN verified_source_url TEXT;
