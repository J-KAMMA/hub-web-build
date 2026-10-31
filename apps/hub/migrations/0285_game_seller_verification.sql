-- ゲーム作者の販売者確認（2026-10-29、docs/hub-software/SELLER-VERIFICATION.md）。
-- Commerce の販売者確認を済ませた人だけが実行ファイルのビルドを公開できる。Hub が持つのは「確認済みの時刻と期限」だけで、
-- Commerce の販売者ID・氏名・住所・本人確認の中身・ウォレットは受け取らず、保存もしない。
-- 一度きりの問いかけ（5分以内）。Commerce が署名する証明に入り、Hub が照合して使い切る。
CREATE TABLE hub_game_seller_challenges (
  challenge TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);
CREATE INDEX idx_hub_game_seller_challenges_profile ON hub_game_seller_challenges (profile_id);

-- 証明の token ID（再送の拒否）。期限が切れたら消してよい。
CREATE TABLE hub_game_seller_proof_jtis (
  jti TEXT PRIMARY KEY,
  used_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- 確認済みの印。期限（180日）が過ぎたら、もう一度確認する。
CREATE TABLE hub_game_seller_verifications (
  profile_id TEXT PRIMARY KEY,
  game_seller_verified_at TEXT NOT NULL,
  game_seller_verified_until TEXT NOT NULL
);
