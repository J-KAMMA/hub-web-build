-- Hubpedia hybrid, phase 0 (docs/hubpedia-hybrid/DESIGN.md sections 0 and 4).
--
-- 1. Per-revision authorship: author_kind ('ai' | 'human' | 'hybrid'), a bounded
--    list of contributor Hub profile IDs, and the AI run that produced the text.
--    Until now authorship could only be inferred from created_by.
-- 2. hubpedia_wiki_audit: migration 0073 dropped the 0072 audit table and never
--    recreated it, yet the wiki workflow writes protection, moderation and
--    proposal events to it. Recreate it keyed by article_key like the rest of
--    the 0073 schema.
--
-- The 0116 publication guard view/triggers are intentionally untouched: they
-- keep deciding AI-only eligibility from created_by / pipelineRunId /
-- hubpedia_article_knowledge_state, not from author_kind.

-- ---------------------------------------------------------------------------
-- encyclopedia_article_revisions
-- ---------------------------------------------------------------------------
ALTER TABLE encyclopedia_article_revisions
  ADD COLUMN author_kind TEXT NOT NULL DEFAULT 'human'
  CHECK (author_kind IN ('ai', 'human', 'hybrid'));
ALTER TABLE encyclopedia_article_revisions
  ADD COLUMN contributors_json TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(contributors_json) AND json_type(contributors_json) = 'array' AND json_array_length(contributors_json) <= 20);
ALTER TABLE encyclopedia_article_revisions ADD COLUMN ai_run_id TEXT;

-- Backfill. Observed writers: lib/encyclopedia/research.ts stores
-- created_by = 'encyclopedia-ai-worker' with generation_metadata.pipelineRunId;
-- migrateSeedArticleBatch stores created_by = 'seed-migration' (curated seed
-- text, treated as human, matching how the 0116 guard treats it). The AI test
-- below is the same one the 0116 guard uses.
UPDATE encyclopedia_article_revisions
SET author_kind = 'ai',
    ai_run_id = CASE
      WHEN json_valid(generation_metadata)
        THEN json_extract(generation_metadata, '$.pipelineRunId')
      ELSE NULL
    END
WHERE created_by = 'encyclopedia-ai-worker'
   OR (json_valid(generation_metadata)
       AND json_extract(generation_metadata, '$.pipelineRunId') IS NOT NULL);

-- Self-healing: a writer that omits author_kind gets the default 'human'. If
-- the row carries the AI markers, correct it right after insert so an AI draft
-- can never be labelled as human-written.
CREATE TRIGGER IF NOT EXISTS encyclopedia_revision_author_kind_ai_markers
AFTER INSERT ON encyclopedia_article_revisions
WHEN NEW.author_kind = 'human'
  AND (NEW.created_by = 'encyclopedia-ai-worker'
       OR (json_valid(NEW.generation_metadata)
           AND json_extract(NEW.generation_metadata, '$.pipelineRunId') IS NOT NULL))
BEGIN
  UPDATE encyclopedia_article_revisions
  SET author_kind = 'ai',
      ai_run_id = COALESCE(ai_run_id,
        CASE WHEN json_valid(NEW.generation_metadata)
             THEN json_extract(NEW.generation_metadata, '$.pipelineRunId') END)
  WHERE id = NEW.id;
END;

-- ---------------------------------------------------------------------------
-- hubpedia_wiki_revisions (community edits; published revisions of the wiki)
-- ---------------------------------------------------------------------------
-- Every existing row came from a human-submitted proposal (AI review only
-- approves a human's proposal), so the default 'human' is a correct backfill.
ALTER TABLE hubpedia_wiki_revisions
  ADD COLUMN author_kind TEXT NOT NULL DEFAULT 'human'
  CHECK (author_kind IN ('ai', 'human', 'hybrid'));
ALTER TABLE hubpedia_wiki_revisions
  ADD COLUMN contributors_json TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(contributors_json) AND json_type(contributors_json) = 'array' AND json_array_length(contributors_json) <= 20);
ALTER TABLE hubpedia_wiki_revisions ADD COLUMN ai_run_id TEXT;

UPDATE hubpedia_wiki_revisions
SET contributors_json = json_array(created_by_profile_id)
WHERE created_by_profile_id IS NOT NULL AND contributors_json = '[]';

-- ---------------------------------------------------------------------------
-- hubpedia_wiki_audit
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hubpedia_wiki_audit (
  id TEXT PRIMARY KEY,
  article_key TEXT REFERENCES hubpedia_wiki_articles(article_key) ON DELETE SET NULL,
  actor_profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hubpedia_wiki_audit_article_action_created
  ON hubpedia_wiki_audit(article_key, action, created_at DESC);
