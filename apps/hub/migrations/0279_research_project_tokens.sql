-- DeSci 研究支援 v1: 研究プロジェクトに結び付けるトークン（1プロジェクト1行）。
-- form はチェーンの読み取りでサーバーが決める。クライアントの入力は使わない。
CREATE TABLE IF NOT EXISTS research_project_tokens (
  project_id TEXT PRIMARY KEY REFERENCES research_projects(id) ON DELETE CASCADE,
  chain_id INTEGER NOT NULL CHECK (chain_id > 0),
  contract TEXT NOT NULL CHECK (length(contract) = 42 AND contract = lower(contract) AND substr(contract, 1, 2) = '0x'),
  kind TEXT NOT NULL CHECK (kind IN ('erc20','erc721','erc1155')),
  sale_address TEXT CHECK (sale_address IS NULL OR (length(sale_address) = 42 AND sale_address = lower(sale_address) AND substr(sale_address, 1, 2) = '0x')),
  form TEXT NOT NULL CHECK (form IN ('donation','sellback','other')),
  acquisition_url TEXT CHECK (acquisition_url IS NULL OR (substr(acquisition_url, 1, 8) = 'https://' AND length(acquisition_url) <= 500)),
  -- 支援者限定ゲート（access_gates.id）。トークンを置き換えると NULL に戻る。
  gate_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (form = 'other' AND sale_address IS NULL)
    OR (form IN ('donation','sellback') AND sale_address IS NOT NULL AND acquisition_url IS NULL AND kind = 'erc20' AND chain_id = 43114)
  )
);
