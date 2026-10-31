-- Topic submissions: a reader proposes a subject and candidate sources, and
-- the factory decides what becomes an article.
--
-- What a submitter supplies is a proposal, never content. Every gate that
-- decides publishability -- publisher licence, verbatim-quote matching,
-- the evidence floor, reader-quality checks -- runs afterwards and cannot be
-- reached from here, which is why this surface can be open while direct
-- editing stays closed.
--
-- Sources are stored as submitted so a rejection can name the URL that
-- caused it, and so an accepted submission can be replayed into a spec.

CREATE TABLE IF NOT EXISTS hubpedia_topic_submissions (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category_label TEXT NOT NULL,
  -- JSON array of {url, title, notes}; validated in the application layer,
  -- kept verbatim here so a review can see exactly what was proposed.
  sources_json TEXT NOT NULL,
  submitter_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  -- 'screened' means the automatic checks ran; a human still admits it to a
  -- run, because generation costs model time.
  status TEXT NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'screened', 'rejected', 'queued', 'produced')),
  screening_json TEXT,
  review_note TEXT,
  reviewer_profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  reviewed_at TEXT,
  batch TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (length(slug) BETWEEN 2 AND 80),
  CHECK (length(title) BETWEEN 1 AND 200),
  CHECK (length(description) BETWEEN 10 AND 600),
  CHECK (length(sources_json) BETWEEN 2 AND 8000),
  -- One live submission per subject: a second proposal for the same slug is
  -- a duplicate, not a competing article.
  UNIQUE (slug)
);

CREATE INDEX IF NOT EXISTS idx_hubpedia_topic_submissions_status
  ON hubpedia_topic_submissions(status, created_at);

CREATE INDEX IF NOT EXISTS idx_hubpedia_topic_submissions_submitter
  ON hubpedia_topic_submissions(submitter_profile_id, created_at);
