ALTER TABLE hubpedia_wiki_proposals ADD COLUMN risk_level TEXT NOT NULL DEFAULT 'high';
ALTER TABLE hubpedia_wiki_proposals ADD COLUMN review_lane TEXT NOT NULL DEFAULT 'human';
ALTER TABLE hubpedia_wiki_proposals ADD COLUMN automated_checks TEXT NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS hubpedia_wiki_proposals_lane_idx
  ON hubpedia_wiki_proposals(status, review_lane, created_at);
