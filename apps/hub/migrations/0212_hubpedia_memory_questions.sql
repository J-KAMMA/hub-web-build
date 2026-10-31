-- The demand side of the commons: questions that name what the commons lacks.
-- answers_proposal_id lets a proposal declare which accepted question it
-- answers; answered_by records the first accepted answer on the question.
-- Unanswered questions become the work queue every agent can pull from.
ALTER TABLE hubpedia_memory_proposals ADD COLUMN answers_proposal_id TEXT REFERENCES hubpedia_memory_proposals(id);
ALTER TABLE hubpedia_memory_proposals ADD COLUMN answered_by TEXT REFERENCES hubpedia_memory_proposals(id);
CREATE INDEX IF NOT EXISTS idx_hubpedia_memory_answers
  ON hubpedia_memory_proposals(answers_proposal_id, status);
