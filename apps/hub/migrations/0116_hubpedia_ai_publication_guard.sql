-- AI-generated revisions may be public only after a supported claim has
-- supporting evidence and the mandatory human-review finding is closed.
CREATE VIEW IF NOT EXISTS hubpedia_publication_eligible_articles AS
SELECT
  a.slug AS article_slug,
  a.current_revision_id AS revision_id,
  'db:' || r.revision_number AS revision_key
FROM encyclopedia_articles a
JOIN encyclopedia_article_revisions r
  ON r.id = a.current_revision_id
WHERE
  NOT (
    r.created_by = 'encyclopedia-ai-worker'
    OR json_extract(r.generation_metadata, '$.pipelineRunId') IS NOT NULL
    OR COALESCE((
      SELECT state.ai_generated_ratio
      FROM hubpedia_article_knowledge_state state
      WHERE state.article_slug = a.slug
    ), 0) > 0
  )
  OR (
    EXISTS (
      SELECT 1
      FROM encyclopedia_revision_claims revision_claim
      JOIN encyclopedia_claims claim
        ON claim.id = revision_claim.claim_id
      WHERE revision_claim.revision_id = a.current_revision_id
        AND claim.status = 'supported'
        AND EXISTS (
          SELECT 1
          FROM encyclopedia_claim_evidence evidence
          WHERE evidence.claim_id = claim.id
            AND evidence.stance = 'supports'
        )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM encyclopedia_review_findings finding
      WHERE finding.revision_id = a.current_revision_id
        AND finding.finding_type = 'ai_generated_requires_review'
        AND finding.status = 'open'
    )
  );

CREATE TRIGGER IF NOT EXISTS hubpedia_ai_publication_approval_insert_guard
BEFORE INSERT ON hubpedia_publication_approvals
WHEN NOT EXISTS (
  SELECT 1
  FROM hubpedia_publication_eligible_articles eligible
  WHERE eligible.article_slug = NEW.article_slug
    AND eligible.revision_key = NEW.approved_revision_key
)
BEGIN
  SELECT RAISE(ABORT, 'Hubpedia publication is not eligible.');
END;

CREATE TRIGGER IF NOT EXISTS hubpedia_ai_publication_approval_update_guard
BEFORE UPDATE OF approved_revision_key, revoked_at ON hubpedia_publication_approvals
WHEN NEW.revoked_at IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM hubpedia_publication_eligible_articles eligible
    WHERE eligible.article_slug = NEW.article_slug
      AND eligible.revision_key = NEW.approved_revision_key
  )
BEGIN
  SELECT RAISE(ABORT, 'Hubpedia publication is not eligible.');
END;
