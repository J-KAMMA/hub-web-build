-- Title search over the Japanese Wikipedia base layer (2026-10-30; lib/encyclopedia/wikipedia/search.ts).
-- Prefix/exact match through two case-insensitive (ASCII) indexes on the raw titles. A trigram FTS over
-- the ~2.2M titles and redirect titles was weighed and not chosen: similar size, no 1-2 character queries,
-- no natural ranking (bm25 needs per-row sizes), and it only adds mid-title matches (音楽 -> 電子音楽).
--
-- Cost: one index entry per article row and per alias row (about 1.25M + 0.96M = 2.2M row writes in total,
-- whether the index exists during the import or is built afterwards), roughly 70 MB (measured at 32 bytes per
-- row on a 350k-title sample). Queries read the rows they return and nothing else.
-- Build this index after a bulk import when possible: the import then writes the rows once without it.
CREATE INDEX IF NOT EXISTS hubpedia_wikipedia_articles_title_nocase_idx
  ON hubpedia_wikipedia_articles(title COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS hubpedia_wikipedia_aliases_title_nocase_idx
  ON hubpedia_wikipedia_aliases(alias_title COLLATE NOCASE);
