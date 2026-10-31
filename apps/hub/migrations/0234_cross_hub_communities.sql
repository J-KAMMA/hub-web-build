-- 段階4: ハブをまたぐコミュニティ（docs/hub-decentralization/DESIGN.md 4.2, 8.4）。
--
-- 持ち主の Hub（このコミュニティを持つ Hub）が、承認・保留・削除・除名・ガバナンス・モデレーター権限をすべて持つ。
-- 外部の人は 0230 の影のプロフィール（kind='remote'）。外部メンバーは役割 member まで。
-- moderator 以上・ガバナンスの提案/投票/委任・所有者は D1 のトリガーで拒む（アプリ層の検査とは別に、書き込み自体を拒む）。

-- 他のハブからの参加。既定はオフ（コミュニティごとにオーナー/モデレーターがオンにする）。
ALTER TABLE communities ADD COLUMN allow_remote_members INTEGER NOT NULL DEFAULT 0
  CHECK (allow_remote_members IN (0, 1));

-- 外部メンバー由来のチャンネル発言。origin_object_id は元の object の URL（二重取り込みを防ぐ）。
ALTER TABLE community_channel_messages ADD COLUMN origin TEXT NOT NULL DEFAULT 'local'
  CHECK (origin IN ('local', 'remote'));
ALTER TABLE community_channel_messages ADD COLUMN origin_object_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_community_channel_messages_origin_object
  ON community_channel_messages(origin_object_id) WHERE origin_object_id IS NOT NULL;

-- Group として公開しているコミュニティの控え。slug は Federation 側の actor URL（/c/{slug}）。
CREATE TABLE IF NOT EXISTS community_federation (
  community_id TEXT PRIMARY KEY REFERENCES communities(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  enabled_at TEXT,
  synced_hash TEXT,
  synced_at TEXT,
  -- この Hub の利用者の発言を外へ出した位置。毎回、オンにした時点から全部を数え直さないための目印。
  hosted_cursor_at TEXT,
  hosted_cursor_id TEXT
);

-- 外部メンバー。state は Hub の判断（持ち主の側）。synced_state は Federation へ伝え終えた状態。
-- 両者が違う間は、Federation が落ちていても次の取り込みで伝え直す。
CREATE TABLE IF NOT EXISTS community_federated_members (
  community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  actor_url TEXT NOT NULL,
  follow_activity_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'active', 'rejected', 'removed', 'banned', 'left')),
  synced_state TEXT NOT NULL CHECK (synced_state IN ('pending', 'active', 'rejected', 'removed', 'banned', 'left')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (community_id, profile_id)
);
CREATE INDEX IF NOT EXISTS idx_community_federated_members_unsynced
  ON community_federated_members(state, synced_state);

-- 外部へ出した（または出す）発言。inbound は外部メンバーの書き込み、hosted はこの Hub の利用者の発言。
-- synced=0 の行は、Federation への通知（announce / reject / 削除）がまだ済んでいない。
CREATE TABLE IF NOT EXISTS community_federated_objects (
  object_url TEXT PRIMARY KEY,
  community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  message_id TEXT,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'hosted')),
  state TEXT NOT NULL CHECK (state IN ('held', 'visible', 'removed', 'rejected')),
  synced INTEGER NOT NULL DEFAULT 0 CHECK (synced IN (0, 1)),
  reason TEXT,
  held_title TEXT,
  held_body TEXT,
  held_channel_id TEXT,
  held_reply_to_message_id TEXT,
  held_published_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_community_federated_objects_unsynced
  ON community_federated_objects(synced, state);
CREATE INDEX IF NOT EXISTS idx_community_federated_objects_message
  ON community_federated_objects(message_id) WHERE message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_community_federated_objects_community
  ON community_federated_objects(community_id, state, created_at);

-- Federation の Group まわりの受信箱の取り込み位置（/v1/group-events）。1行だけ。
CREATE TABLE IF NOT EXISTS federation_group_inbound_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  cursor TEXT NOT NULL DEFAULT '0',
  last_pulled_at TEXT,
  stuck_cursor TEXT,
  stuck_attempts INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO federation_group_inbound_state(id, cursor) VALUES (1, '0');

-- 参加する側: 他のハブのコミュニティ。表示するのは、持ち主の Hub が Announce した発言だけ。
CREATE TABLE IF NOT EXISTS remote_communities (
  id TEXT PRIMARY KEY,
  group_url TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL,
  host TEXT NOT NULL,
  name TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  channels_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (length(group_url) <= 2048),
  CHECK (length(name) <= 100),
  CHECK (length(host) <= 255)
);

CREATE TABLE IF NOT EXISTS remote_community_subscriptions (
  remote_community_id TEXT NOT NULL REFERENCES remote_communities(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  federation_subscription_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'accepted', 'rejected', 'removed', 'banned', 'left')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (remote_community_id, profile_id)
);
CREATE INDEX IF NOT EXISTS idx_remote_community_subscriptions_profile
  ON remote_community_subscriptions(profile_id, state);
CREATE INDEX IF NOT EXISTS idx_remote_community_subscriptions_federation
  ON remote_community_subscriptions(federation_subscription_id);

CREATE TABLE IF NOT EXISTS remote_community_items (
  id TEXT PRIMARY KEY,
  remote_community_id TEXT NOT NULL REFERENCES remote_communities(id) ON DELETE CASCADE,
  object_url TEXT NOT NULL UNIQUE,
  object_type TEXT NOT NULL CHECK (object_type IN ('Page', 'Note')),
  title TEXT,
  body TEXT NOT NULL,
  in_reply_to_url TEXT,
  channel_name TEXT,
  author_kind TEXT NOT NULL CHECK (author_kind IN ('actor', 'host')),
  author_actor_url TEXT,
  author_handle TEXT,
  author_name TEXT,
  published_at TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'visible' CHECK (state IN ('visible', 'removed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (length(body) <= 4000)
);
CREATE INDEX IF NOT EXISTS idx_remote_community_items_timeline
  ON remote_community_items(remote_community_id, state, published_at DESC, id);
CREATE INDEX IF NOT EXISTS idx_remote_community_items_reply
  ON remote_community_items(in_reply_to_url) WHERE in_reply_to_url IS NOT NULL;

-- ===== 外部メンバーの権限の上限（D1 の側から守る） =====

-- 役割は member まで。moderator 以上にも owner にもできない（挿入でも更新でも）。
CREATE TRIGGER IF NOT EXISTS remote_profile_membership_role_is_member_insert
BEFORE INSERT ON community_memberships
WHEN NEW.role <> 'member' AND (SELECT kind FROM profiles WHERE id = NEW.profile_id) = 'remote'
BEGIN
  SELECT RAISE(ABORT, 'remote_profile_cannot_hold_community_role');
END;

CREATE TRIGGER IF NOT EXISTS remote_profile_membership_role_is_member_update
BEFORE UPDATE OF role ON community_memberships
WHEN NEW.role <> 'member' AND (SELECT kind FROM profiles WHERE id = NEW.profile_id) = 'remote'
BEGIN
  SELECT RAISE(ABORT, 'remote_profile_cannot_hold_community_role');
END;

CREATE TRIGGER IF NOT EXISTS remote_profile_cannot_own_community_insert
BEFORE INSERT ON communities
WHEN (SELECT kind FROM profiles WHERE id = NEW.owner_profile_id) = 'remote'
BEGIN
  SELECT RAISE(ABORT, 'remote_profile_cannot_own_community');
END;

CREATE TRIGGER IF NOT EXISTS remote_profile_cannot_own_community_update
BEFORE UPDATE OF owner_profile_id ON communities
WHEN (SELECT kind FROM profiles WHERE id = NEW.owner_profile_id) = 'remote'
BEGIN
  SELECT RAISE(ABORT, 'remote_profile_cannot_own_community');
END;

-- 独自の役職（権限の束）も付けられない。
CREATE TRIGGER IF NOT EXISTS remote_profile_cannot_hold_custom_role
BEFORE INSERT ON community_member_custom_roles
WHEN (SELECT kind FROM profiles WHERE id = NEW.profile_id) = 'remote'
BEGIN
  SELECT RAISE(ABORT, 'remote_profile_cannot_hold_community_role');
END;

-- ガバナンス: 提案・投票・委任（する側もされる側も）・投票権の控えに入れない。
CREATE TRIGGER IF NOT EXISTS remote_profile_cannot_vote
BEFORE INSERT ON community_governance_votes
WHEN (SELECT kind FROM profiles WHERE id = NEW.profile_id) = 'remote'
BEGIN
  SELECT RAISE(ABORT, 'remote_profile_cannot_govern');
END;

CREATE TRIGGER IF NOT EXISTS remote_profile_cannot_propose
BEFORE INSERT ON community_governance_proposals
WHEN (SELECT kind FROM profiles WHERE id = NEW.author_profile_id) = 'remote'
BEGIN
  SELECT RAISE(ABORT, 'remote_profile_cannot_govern');
END;

CREATE TRIGGER IF NOT EXISTS remote_profile_cannot_delegate
BEFORE INSERT ON community_governance_delegations
WHEN (SELECT kind FROM profiles WHERE id = NEW.delegator_profile_id) = 'remote'
  OR (SELECT kind FROM profiles WHERE id = NEW.delegate_profile_id) = 'remote'
BEGIN
  SELECT RAISE(ABORT, 'remote_profile_cannot_govern');
END;

CREATE TRIGGER IF NOT EXISTS remote_profile_has_no_vote_snapshot
BEFORE INSERT ON community_governance_vote_snapshots
WHEN (SELECT kind FROM profiles WHERE id = NEW.profile_id) = 'remote'
BEGIN
  SELECT RAISE(ABORT, 'remote_profile_cannot_govern');
END;

-- 外部由来の発言は、他のハブからの参加がオンのコミュニティにだけ入れる。
CREATE TRIGGER IF NOT EXISTS remote_message_requires_remote_participation
BEFORE INSERT ON community_channel_messages
WHEN NEW.origin = 'remote' AND NOT EXISTS (
  SELECT 1 FROM community_channels ch JOIN communities c ON c.id = ch.community_id
  WHERE ch.id = NEW.channel_id AND c.allow_remote_members = 1
)
BEGIN
  SELECT RAISE(ABORT, 'remote_participation_disabled');
END;

-- 外部の人（影のプロフィール）の発言は origin='remote'、そうでない人は origin='local'。取り違えさせない。
CREATE TRIGGER IF NOT EXISTS remote_message_origin_matches_author
BEFORE INSERT ON community_channel_messages
WHEN (NEW.origin = 'remote') <> ((SELECT kind FROM profiles WHERE id = NEW.author_profile_id) = 'remote')
BEGIN
  SELECT RAISE(ABORT, 'message_origin_mismatch');
END;

-- 参加する側の購読は、この Hub の利用者（kind='local'）だけ。
CREATE TRIGGER IF NOT EXISTS remote_community_subscription_is_local
BEFORE INSERT ON remote_community_subscriptions
WHEN (SELECT kind FROM profiles WHERE id = NEW.profile_id) = 'remote'
BEGIN
  SELECT RAISE(ABORT, 'remote_profile_cannot_subscribe');
END;

-- ===== 既存の moderation の結果を、外へ伝える印に写す（トリガー） =====
-- 持ち主の Hub の moderator が発言を消す・メンバーを外す/禁止する・申請を決める操作は、既存の経路のまま動く。
-- ここでは結果を印（state）に写すだけ。Federation への通知（Delete / Remove / Block / Accept / Reject）は、
-- 取り込みのたびに synced=0 / state<>synced_state の行だけを拾って行う（全行を走査しない）。

-- 消された発言（モデレーターの削除、チャンネルごと消える場合も）。
CREATE TRIGGER IF NOT EXISTS community_federated_object_message_deleted
AFTER DELETE ON community_channel_messages
WHEN EXISTS (SELECT 1 FROM community_federated_objects WHERE message_id = OLD.id AND state = 'visible')
BEGIN
  UPDATE community_federated_objects
  SET state = 'removed', synced = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE message_id = OLD.id AND state = 'visible';
END;

-- 禁止。
CREATE TRIGGER IF NOT EXISTS community_federated_member_banned
AFTER UPDATE OF status ON community_memberships
WHEN NEW.status = 'banned'
BEGIN
  UPDATE community_federated_members
  SET state = 'banned', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE community_id = NEW.community_id AND profile_id = NEW.profile_id AND state IN ('pending', 'active');
END;

-- 除名（メンバー行が消える）。
CREATE TRIGGER IF NOT EXISTS community_federated_member_removed
AFTER DELETE ON community_memberships
BEGIN
  UPDATE community_federated_members
  SET state = 'removed', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE community_id = OLD.community_id AND profile_id = OLD.profile_id AND state = 'active';
END;

-- 承認制の申請が承認された（通常の承認と同じくメンバー行が入る）。
CREATE TRIGGER IF NOT EXISTS community_federated_member_activated
AFTER INSERT ON community_memberships
WHEN NEW.status IN ('active', 'muted')
BEGIN
  UPDATE community_federated_members
  SET state = 'active', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE community_id = NEW.community_id AND profile_id = NEW.profile_id AND state = 'pending';
END;

-- 承認制の申請が却下・取り下げされた。
CREATE TRIGGER IF NOT EXISTS community_federated_member_request_declined
AFTER UPDATE OF status ON community_membership_requests
WHEN NEW.status IN ('rejected', 'cancelled')
BEGIN
  UPDATE community_federated_members
  SET state = 'rejected', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE community_id = NEW.community_id AND profile_id = NEW.profile_id AND state = 'pending';
END;
