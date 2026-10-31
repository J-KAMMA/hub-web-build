-- 登録時の同意の記録（2026-10-14、所有者承認）。
--
-- 規約とプライバシーポリシーの「どの版に」「いつ」同意したか、16歳以上の確認を
-- したか、を残す。同意の証明と、版が変わったときの再同意の判断に使う。
-- 生年月日は集めない。残すのは「16歳以上と確認した」という事実の最低年齢だけ。
--
-- 版の文字列は lib/hub-consent.ts が正本。この表は文字列を検証しない
-- （版が増えても migration が要らないように）。
-- 利用者が消えれば（profiles の削除）記録も消える。
-- 既存の利用者に記録は作らない（強制の再同意はしない）。

CREATE TABLE IF NOT EXISTS hub_consent_records (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  terms_version TEXT NOT NULL CHECK (length(terms_version) BETWEEN 1 AND 40),
  privacy_version TEXT NOT NULL CHECK (length(privacy_version) BETWEEN 1 AND 40),
  minimum_age_confirmed INTEGER NOT NULL CHECK (minimum_age_confirmed BETWEEN 13 AND 99),
  source TEXT NOT NULL CHECK (source IN ('passkey_signup', 'account_signup')),
  consented_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_hub_consent_records_profile
  ON hub_consent_records(profile_id, consented_at);
