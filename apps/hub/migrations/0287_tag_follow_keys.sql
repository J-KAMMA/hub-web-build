-- Article tag follows compare by the shared tag key (2026-10-29). The key cannot be computed in SQL
-- (NFKC, full case folding); scripts/backfill-tag-index.mjs fills it for existing rows. New rows get it from
-- the application. tag stays the legacy raw value (primary key) so old rows keep working until backfilled.

ALTER TABLE hub_article_tag_follows ADD COLUMN tag_key TEXT;

CREATE INDEX IF NOT EXISTS idx_hub_article_tag_follows_key ON hub_article_tag_follows(tag_key, profile_id);
