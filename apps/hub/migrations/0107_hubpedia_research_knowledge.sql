CREATE TABLE IF NOT EXISTS hubpedia_research_works (
  id TEXT PRIMARY KEY,
  work_type TEXT NOT NULL CHECK (work_type IN ('paper','preprint','review','dataset','code','formal-proof','public-record')),
  title TEXT NOT NULL,
  abstract TEXT,
  research_question TEXT,
  methods TEXT,
  results TEXT,
  novelty TEXT,
  limitations TEXT,
  canonical_url TEXT NOT NULL,
  doi TEXT,
  arxiv_id TEXT,
  authors_json TEXT NOT NULL DEFAULT '[]',
  publisher TEXT,
  published_at TEXT,
  peer_review_state TEXT NOT NULL DEFAULT 'unknown'
    CHECK (peer_review_state IN ('unknown','not-reviewed','under-review','peer-reviewed','retracted')),
  evidence_type TEXT NOT NULL DEFAULT 'other'
    CHECK (evidence_type IN ('mathematical-proof','experiment','observation','simulation','meta-analysis','replication','expert-consensus','ai-verification','dataset','code','other')),
  license_name TEXT,
  license_url TEXT,
  content_hash TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS hubpedia_research_works_doi_uidx
  ON hubpedia_research_works(lower(doi)) WHERE doi IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS hubpedia_research_works_arxiv_uidx
  ON hubpedia_research_works(lower(arxiv_id)) WHERE arxiv_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS hubpedia_article_research_works (
  article_slug TEXT NOT NULL,
  work_id TEXT NOT NULL REFERENCES hubpedia_research_works(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('original','supports','opposes','replicates','review','background','dataset','code','formal-proof')),
  importance INTEGER NOT NULL DEFAULT 50 CHECK (importance BETWEEN 0 AND 100),
  note TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (article_slug, work_id, role)
);
CREATE INDEX IF NOT EXISTS hubpedia_article_research_works_article_idx
  ON hubpedia_article_research_works(article_slug, importance DESC);

CREATE TABLE IF NOT EXISTS hubpedia_claim_knowledge_state (
  claim_id TEXT PRIMARY KEY REFERENCES encyclopedia_claims(id) ON DELETE CASCADE,
  knowledge_status TEXT NOT NULL
    CHECK (knowledge_status IN ('established','strong-evidence','provisional','disputed','unverified','refuted')),
  evidence_type TEXT
    CHECK (evidence_type IS NULL OR evidence_type IN ('mathematical-proof','experiment','observation','simulation','meta-analysis','replication','expert-consensus','ai-verification','dataset','code','other')),
  scope TEXT,
  reproducibility TEXT NOT NULL DEFAULT 'unknown'
    CHECK (reproducibility IN ('unknown','not-applicable','not-attempted','partially-reproduced','reproduced','failed-replication')),
  confidence REAL CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  last_checked_at TEXT,
  checked_by TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hubpedia_article_knowledge_state (
  article_slug TEXT PRIMARY KEY,
  article_type TEXT NOT NULL
    CHECK (article_type IN ('concept','paper','person','technology','event','organism','place','culture','general')),
  knowledge_status TEXT NOT NULL
    CHECK (knowledge_status IN ('established','partially-unresolved','provisional','disputed','unverified','refuted')),
  reproducibility TEXT NOT NULL DEFAULT 'unknown'
    CHECK (reproducibility IN ('unknown','not-applicable','not-attempted','partially-reproduced','reproduced','failed-replication')),
  last_synthesized_at TEXT,
  ai_generated_ratio REAL NOT NULL DEFAULT 1 CHECK (ai_generated_ratio >= 0 AND ai_generated_ratio <= 1),
  human_review_scope TEXT,
  synthesis_version TEXT,
  updated_at TEXT NOT NULL
);
