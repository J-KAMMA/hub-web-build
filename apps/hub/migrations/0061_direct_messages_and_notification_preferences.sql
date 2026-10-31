CREATE TABLE IF NOT EXISTS direct_message_preferences (
  profile_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  receive_policy TEXT NOT NULL DEFAULT 'mutuals',
  updated_at TEXT NOT NULL,
  CHECK (receive_policy IN ('mutuals', 'following', 'nobody'))
);

CREATE TABLE IF NOT EXISTS direct_conversation_pairs (
  first_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  second_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL UNIQUE REFERENCES conversations(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (first_profile_id, second_profile_id),
  CHECK (first_profile_id < second_profile_id)
);

CREATE TABLE IF NOT EXISTS notification_preferences (
  profile_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  replies_enabled INTEGER NOT NULL DEFAULT 1,
  reactions_enabled INTEGER NOT NULL DEFAULT 1,
  follows_enabled INTEGER NOT NULL DEFAULT 1,
  messages_enabled INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  CHECK (replies_enabled IN (0, 1)),
  CHECK (reactions_enabled IN (0, 1)),
  CHECK (follows_enabled IN (0, 1)),
  CHECK (messages_enabled IN (0, 1))
);

CREATE INDEX IF NOT EXISTS idx_direct_conversation_pairs_conversation
  ON direct_conversation_pairs(conversation_id);
