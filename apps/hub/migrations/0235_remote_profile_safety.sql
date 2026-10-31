-- 他のハブの人（kind='remote' の影の行）には DM を届けられない（所有者決定 2026-10-13: ハブ間 DM は当面しない）。
-- API が拒むのとは別に、D1 側でも会話への参加と DM の組を拒む。
CREATE TRIGGER IF NOT EXISTS remote_profile_cannot_join_conversation
BEFORE INSERT ON conversation_participants
WHEN (SELECT kind FROM profiles WHERE id = NEW.profile_id) = 'remote'
BEGIN
  SELECT RAISE(ABORT, 'remote_profile_cannot_receive_direct_messages');
END;

CREATE TRIGGER IF NOT EXISTS remote_profile_cannot_pair_direct_conversation
BEFORE INSERT ON direct_conversation_pairs
WHEN (SELECT kind FROM profiles WHERE id = NEW.first_profile_id) = 'remote'
  OR (SELECT kind FROM profiles WHERE id = NEW.second_profile_id) = 'remote'
BEGIN
  SELECT RAISE(ABORT, 'remote_profile_cannot_receive_direct_messages');
END;

CREATE TRIGGER IF NOT EXISTS remote_profile_cannot_send_direct_message
BEFORE INSERT ON direct_messages
WHEN (SELECT kind FROM profiles WHERE id = NEW.sender_profile_id) = 'remote'
BEGIN
  SELECT RAISE(ABORT, 'remote_profile_cannot_receive_direct_messages');
END;

-- 他のハブの人の画像URLは保存しない。閲覧者のブラウザが相手のサーバーへ画像を取りに行き、IPが漏れる。
-- 画面は頭字のアバターで表示する。既存の行を空にし、以後の書き込みは D1 側で拒む。
UPDATE profiles SET avatar_url = NULL WHERE kind = 'remote' AND avatar_url IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS remote_profile_avatar_refused_on_insert
BEFORE INSERT ON profiles
WHEN NEW.kind = 'remote' AND NEW.avatar_url IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'remote_profile_cannot_have_external_avatar');
END;

CREATE TRIGGER IF NOT EXISTS remote_profile_avatar_refused_on_update
BEFORE UPDATE OF avatar_url ON profiles
WHEN NEW.kind = 'remote' AND NEW.avatar_url IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'remote_profile_cannot_have_external_avatar');
END;
