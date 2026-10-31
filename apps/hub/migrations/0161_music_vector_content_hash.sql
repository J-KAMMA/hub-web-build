-- What was embedded, not merely that something was. Without it, an edit to any
-- work looks the same as an edit to none, so the choice is between re-embedding
-- everything and re-embedding nothing. Both are wrong once posts and articles
-- join the index: embedding is the part that costs, and Vectorize counts an
-- insert as a query.
ALTER TABLE music_work_vectors ADD COLUMN content_hash TEXT;
