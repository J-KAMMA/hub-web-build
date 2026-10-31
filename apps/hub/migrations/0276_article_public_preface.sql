-- The part of a gated article that the author deliberately shows to everyone, above the "ここから先は鍵つきです" line.
-- It is written separately by the author and is never derived from the body.
ALTER TABLE hub_user_articles ADD COLUMN public_preface TEXT NOT NULL DEFAULT '';
ALTER TABLE hub_user_article_drafts ADD COLUMN public_preface TEXT NOT NULL DEFAULT '';
