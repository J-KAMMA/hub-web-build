-- 段階2: 持ち運べる身元・書き出し/取り込み・移転（docs/hub-decentralization/DESIGN.md 2・3）。
--
-- ここに置くのは「公開されている物」と「この Hub が行った操作の記録」だけ。
--   - 根鍵は公開鍵（did:key）のみ。秘密鍵は作らない・預からない・回復しない（AGENTS.md、2026-10-12 承認）。
--   - 根鍵・actor URL は Account / Identity / Commerce / Vault / Music / Mail / AI へ渡さない。
--     この表は Account subject・ウォレット・メール・Vault の ID と同じ行に置かない（profile_id と公開鍵だけ）。
--   - Hub のプロフィール ID は根鍵や actor URL から作らない（既存の規則）。

-- 利用者が公開した根鍵。ログイン資格ではない（認証はパスキーか Account）。ウォレット鍵としても使わない。
CREATE TABLE IF NOT EXISTS hub_portable_identities (
  profile_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  root_key_did TEXT NOT NULL,
  registered_at TEXT NOT NULL,
  CHECK (root_key_did LIKE 'did:key:zDn%' AND length(root_key_did) <= 120)
);

-- 影のプロフィール（外部の人）は根鍵の持ち主として登録できない。
CREATE TRIGGER IF NOT EXISTS remote_profile_cannot_hold_portable_identity
BEFORE INSERT ON hub_portable_identities
WHEN (SELECT kind FROM profiles WHERE id = NEW.profile_id) = 'remote'
BEGIN
  SELECT RAISE(ABORT, 'remote_profile_cannot_hold_portable_identity');
END;

-- この Hub から別の Hub へ移った記録。redirect_until まで、プロフィールページを新しい家へ永続リダイレクトする。
CREATE TABLE IF NOT EXISTS hub_account_moves (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  old_actor TEXT NOT NULL,
  new_actor TEXT NOT NULL,
  new_profile_url TEXT,
  mode TEXT NOT NULL CHECK (mode IN ('cooperative')),
  moved_at TEXT NOT NULL,
  redirect_until TEXT NOT NULL,
  CHECK (length(old_actor) <= 2048 AND length(new_actor) <= 2048)
);
CREATE INDEX IF NOT EXISTS idx_hub_account_moves_profile ON hub_account_moves(profile_id, moved_at DESC);

-- 他の Hub から取り込んだ投稿（「移転前の投稿」）。元の日時を保ち、外部へは配り直さない。
-- provenance: verified = 束の根鍵で署名が通った / unverified = 署名なし（出自未確認）。
CREATE TABLE IF NOT EXISTS hub_imported_posts (
  post_id TEXT PRIMARY KEY REFERENCES social_posts(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  original_id TEXT NOT NULL,
  original_published_at TEXT NOT NULL,
  in_reply_to_url TEXT,
  proof_json TEXT,
  provenance TEXT NOT NULL CHECK (provenance IN ('verified','unverified')),
  source_actor TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  CHECK (length(original_id) <= 2048)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_hub_imported_posts_original ON hub_imported_posts(profile_id, original_id);

-- 取り込み後に自己署名の移転を送るための手がかり。束に入っていたフォロワーの公開 actor と inbox だけ。
CREATE TABLE IF NOT EXISTS hub_import_move_hints (
  profile_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  old_actor TEXT NOT NULL,
  root_key_did TEXT,
  followers_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  moved_at TEXT
);

-- 移転した外部の人。影のプロフィールの画面に「移転しました」を出すために使う。
ALTER TABLE remote_actor_profiles ADD COLUMN moved_to_actor_url TEXT;
