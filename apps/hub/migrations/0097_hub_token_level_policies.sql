PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS hub_token_level_policies (
  level_key TEXT PRIMARY KEY CHECK(level_key IN ('supporter','silver','gold','platinum')),
  min_units INTEGER NOT NULL CHECK(min_units >= 0),
  benefits_json TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  updated_at TEXT NOT NULL
);

INSERT INTO hub_token_level_policies(level_key,min_units,benefits_json,active,updated_at) VALUES
 ('supporter',0,'[]',1,'2026-07-22T00:00:00.000Z'),
 ('silver',100000,'["限定プロフィールバッジ"]',1,'2026-07-22T00:00:00.000Z'),
 ('gold',1000000,'["限定プロフィールバッジ","新機能の先行利用"]',1,'2026-07-22T00:00:00.000Z'),
 ('platinum',10000000,'["限定プロフィールバッジ","新機能の先行利用","フィードバック優先受付"]',1,'2026-07-22T00:00:00.000Z');

