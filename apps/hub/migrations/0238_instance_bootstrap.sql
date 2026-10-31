-- 自前ハブの最初の運営者（2026-10-13、DESIGN.md 5.2）。
-- hub_instance_operators: 環境の HUB_OPERATOR_PROFILE_IDS と並ぶ運営者の名簿。最初の1人は /setup/admin が書く。
-- hub_bootstrap_state: 使い切りの印。claimed_at が入った後は /setup/admin は 404。トークン本体は持たない。
CREATE TABLE IF NOT EXISTS hub_instance_operators (
  profile_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  granted_at TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('bootstrap'))
);

CREATE TABLE IF NOT EXISTS hub_bootstrap_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  claimed_at TEXT,
  claimed_profile_id TEXT,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  window_started_at TEXT
);
