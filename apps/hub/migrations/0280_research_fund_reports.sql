-- DeSci 研究支援 v1 step 4: 資金の使い道の報告。公開で読め、ゲートしない。Hub は資金を預からない。
CREATE TABLE IF NOT EXISTS research_fund_reports (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 8 AND 64),
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  amount TEXT CHECK (amount IS NULL OR length(amount) BETWEEN 1 AND 60),
  evidence_url TEXT CHECK (evidence_url IS NULL OR (substr(evidence_url, 1, 8) = 'https://' AND length(evidence_url) <= 500)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_research_fund_reports_project_created
  ON research_fund_reports(project_id, created_at DESC);
