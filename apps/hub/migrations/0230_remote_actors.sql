-- 段階1: ハブをまたぐフォロー・返信・いいね（docs/hub-decentralization/DESIGN.md 4.1）。
--
-- 外部の人は profiles に「影の行」（kind='remote'）として置く。ID は乱数で、actor URL や鍵から作らない。
-- 影の行はログインできない・セッションを持てない・Account/ウォレットと結び付かない。
-- これを下のトリガーで D1 側からも守る（認可の層とは別に、書き込み自体を拒む）。

ALTER TABLE profiles ADD COLUMN kind TEXT NOT NULL DEFAULT 'local' CHECK (kind IN ('local','remote'));

-- kind は作った後で変えられない（local を remote に書き換えて認証済みの行を隠す、またはその逆を防ぐ）。
CREATE TRIGGER IF NOT EXISTS profiles_kind_is_immutable
BEFORE UPDATE OF kind ON profiles
WHEN NEW.kind <> OLD.kind
BEGIN
  SELECT RAISE(ABORT, 'profile_kind_is_immutable');
END;

CREATE TRIGGER IF NOT EXISTS remote_profile_cannot_have_session
BEFORE INSERT ON sessions
WHEN (SELECT kind FROM profiles WHERE id = NEW.profile_id) = 'remote'
BEGIN
  SELECT RAISE(ABORT, 'remote_profile_cannot_authenticate');
END;

CREATE TRIGGER IF NOT EXISTS remote_profile_cannot_have_password
BEFORE INSERT ON profile_credentials
WHEN (SELECT kind FROM profiles WHERE id = NEW.profile_id) = 'remote'
BEGIN
  SELECT RAISE(ABORT, 'remote_profile_cannot_authenticate');
END;

CREATE TRIGGER IF NOT EXISTS remote_profile_cannot_have_passkey
BEFORE INSERT ON profile_passkeys
WHEN (SELECT kind FROM profiles WHERE id = NEW.profile_id) = 'remote'
BEGIN
  SELECT RAISE(ABORT, 'remote_profile_cannot_authenticate');
END;

CREATE TRIGGER IF NOT EXISTS remote_profile_cannot_link_wallet
BEFORE INSERT ON profile_wallet_links
WHEN (SELECT kind FROM profiles WHERE id = NEW.profile_id) = 'remote'
BEGIN
  SELECT RAISE(ABORT, 'remote_profile_cannot_link_wallet');
END;

CREATE TRIGGER IF NOT EXISTS remote_profile_cannot_link_account
BEFORE INSERT ON account_profile_links
WHEN (SELECT kind FROM profiles WHERE id = NEW.profile_id) = 'remote'
BEGIN
  SELECT RAISE(ABORT, 'remote_profile_cannot_link_account');
END;

CREATE TRIGGER IF NOT EXISTS remote_profile_cannot_link_desktop_account
BEFORE INSERT ON desktop_account_profile_links
WHEN (SELECT kind FROM profiles WHERE id = NEW.profile_id) = 'remote'
BEGIN
  SELECT RAISE(ABORT, 'remote_profile_cannot_link_account');
END;

-- 影の行には通知を作らない（人がいない）。RAISE(IGNORE) は挿入だけを黙って捨てる。
CREATE TRIGGER IF NOT EXISTS remote_profile_receives_no_notifications
BEFORE INSERT ON notifications
WHEN (SELECT kind FROM profiles WHERE id = NEW.receiver_profile_id) = 'remote'
BEGIN
  SELECT RAISE(IGNORE);
END;

-- 外部の人の公開情報。Account・ウォレット・メールなどの識別子は持たない。
CREATE TABLE IF NOT EXISTS remote_actor_profiles (
  profile_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  actor_url TEXT NOT NULL UNIQUE,
  handle TEXT NOT NULL,
  host TEXT NOT NULL,
  inbox_url TEXT,
  profile_url TEXT,
  fetched_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK (length(actor_url) <= 2048),
  CHECK (length(handle) <= 320),
  CHECK (length(host) <= 255)
);
CREATE INDEX IF NOT EXISTS idx_remote_actor_profiles_host ON remote_actor_profiles(host);

-- 外部から取り込んだ投稿。origin_object_id は元の object の URL（二重取り込みを防ぐ）。
ALTER TABLE social_posts ADD COLUMN origin TEXT NOT NULL DEFAULT 'local' CHECK (origin IN ('local','remote'));
ALTER TABLE social_posts ADD COLUMN origin_object_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_social_posts_origin_object
  ON social_posts(origin_object_id) WHERE origin_object_id IS NOT NULL;

-- ローカルの利用者が外部の人をフォローした状態。承認（Accept）されるまで follows には入れない。
CREATE TABLE IF NOT EXISTS remote_follows (
  follower_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  remote_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  federation_follow_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending','accepted','rejected')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (follower_profile_id, remote_profile_id)
);
CREATE INDEX IF NOT EXISTS idx_remote_follows_federation ON remote_follows(federation_follow_id);

-- 外部の人から受けた Like。Undo は Like の activity ID で届くので対応を覚える。
CREATE TABLE IF NOT EXISTS remote_reactions (
  activity_id TEXT PRIMARY KEY,
  reaction_id TEXT,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Federation の受信箱の取り込み位置。1行だけ。stuck_* は取り込めない出来事を何回目で諦めるかの印。
CREATE TABLE IF NOT EXISTS federation_inbound_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  cursor TEXT NOT NULL DEFAULT '0',
  last_pulled_at TEXT,
  stuck_cursor TEXT,
  stuck_attempts INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO federation_inbound_state(id, cursor) VALUES (1, '0');

-- Federation から届いたドメイン方針。影のプロフィールを後から作るときにも停止を反映する。
CREATE TABLE IF NOT EXISTS federation_domain_policies (
  domain TEXT PRIMARY KEY,
  action TEXT NOT NULL CHECK (action IN ('allow','limit','suspend')),
  updated_at TEXT NOT NULL
);
