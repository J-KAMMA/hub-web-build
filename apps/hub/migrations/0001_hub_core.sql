PRAGMA foreign_keys = ON;

-- Hub-local pseudonymous profiles. Do not add legal identity, contact,
-- Identity-service, commerce-account, or wallet-owner identifiers here.
CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  handle TEXT NOT NULL COLLATE NOCASE,
  display_name TEXT NOT NULL,
  bio TEXT NOT NULL DEFAULT '',
  avatar_url TEXT,
  joined_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (length(trim(id)) > 0),
  CHECK (length(handle) BETWEEN 1 AND 32),
  CHECK (length(display_name) BETWEEN 1 AND 80),
  CHECK (length(bio) <= 500),
  CHECK (avatar_url IS NULL OR length(avatar_url) <= 2048),
  UNIQUE (handle)
);

-- Only a one-way hash of the opaque session secret is persisted. Cookie
-- Domain/Path/SameSite/Secure attributes remain application concerns.
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  secret_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  CHECK (length(secret_hash) >= 32),
  CHECK (expires_at > created_at),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);
CREATE INDEX IF NOT EXISTS idx_sessions_profile_active
  ON sessions(profile_id, revoked_at, expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS boards (
  id TEXT PRIMARY KEY,
  board_key TEXT NOT NULL COLLATE NOCASE UNIQUE,
  title TEXT NOT NULL,
  slug TEXT NOT NULL COLLATE NOCASE UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (length(board_key) BETWEEN 1 AND 64),
  CHECK (length(title) BETWEEN 1 AND 120),
  CHECK (length(slug) BETWEEN 1 AND 100),
  CHECK (length(description) <= 1000)
);

CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE RESTRICT,
  created_by_profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'ja',
  region TEXT NOT NULL DEFAULT 'global',
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (length(title) BETWEEN 1 AND 240),
  CHECK (language IN ('ja','en','ko','zh-CN','es','fr','de','pt','ar','hi','other')),
  CHECK (region IN ('global','africa','asia-pacific','europe','latin-america-caribbean','middle-east-north-africa','north-america','local')),
  CHECK (pinned IN (0, 1))
);
CREATE INDEX IF NOT EXISTS idx_threads_board_updated
  ON threads(board_id, pinned DESC, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_threads_scope_updated
  ON threads(language, region, updated_at DESC);

CREATE TABLE IF NOT EXISTS thread_posts (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  post_no INTEGER NOT NULL,
  author_profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  display_name TEXT NOT NULL,
  body TEXT NOT NULL,
  reply_to_post_id TEXT REFERENCES thread_posts(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  CHECK (post_no > 0),
  CHECK (length(display_name) BETWEEN 1 AND 80),
  CHECK (length(body) BETWEEN 1 AND 20000),
  CHECK (reply_to_post_id IS NULL OR reply_to_post_id <> id),
  UNIQUE (thread_id, post_no)
);
CREATE INDEX IF NOT EXISTS idx_thread_posts_thread_created
  ON thread_posts(thread_id, post_no);
CREATE INDEX IF NOT EXISTS idx_thread_posts_author_created
  ON thread_posts(author_profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_thread_posts_reply
  ON thread_posts(reply_to_post_id);

CREATE TABLE IF NOT EXISTS social_posts (
  id TEXT PRIMARY KEY,
  author_profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  display_name TEXT NOT NULL,
  handle TEXT,
  identity_mode TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  reply_to_post_id TEXT REFERENCES social_posts(id) ON DELETE SET NULL,
  repost_of_target_type TEXT,
  repost_of_target_id TEXT,
  quote_of_target_type TEXT,
  quote_of_target_id TEXT,
  CHECK (length(display_name) BETWEEN 1 AND 80),
  CHECK (handle IS NULL OR length(handle) BETWEEN 1 AND 32),
  CHECK (identity_mode IN ('account','guest','anonymous')),
  CHECK (length(body) <= 20000),
  CHECK (reply_to_post_id IS NULL OR reply_to_post_id <> id),
  CHECK ((repost_of_target_type IS NULL) = (repost_of_target_id IS NULL)),
  CHECK ((quote_of_target_type IS NULL) = (quote_of_target_id IS NULL)),
  CHECK (repost_of_target_type IS NULL OR repost_of_target_type IN ('social_post','thread_post')),
  CHECK (quote_of_target_type IS NULL OR quote_of_target_type IN ('social_post','thread_post')),
  CHECK (length(body) > 0 OR repost_of_target_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_social_posts_created ON social_posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_social_posts_author_created
  ON social_posts(author_profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_social_posts_reply ON social_posts(reply_to_post_id);
CREATE INDEX IF NOT EXISTS idx_social_posts_repost_target
  ON social_posts(repost_of_target_type, repost_of_target_id);
CREATE INDEX IF NOT EXISTS idx_social_posts_quote_target
  ON social_posts(quote_of_target_type, quote_of_target_id);

CREATE TABLE IF NOT EXISTS follows (
  follower_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  followed_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (follower_profile_id, followed_profile_id),
  CHECK (follower_profile_id <> followed_profile_id)
);
CREATE INDEX IF NOT EXISTS idx_follows_followed
  ON follows(followed_profile_id, created_at DESC);

CREATE TABLE IF NOT EXISTS user_lists (
  id TEXT PRIMARY KEY,
  owner_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  visibility TEXT NOT NULL DEFAULT 'private',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (length(name) BETWEEN 1 AND 100),
  CHECK (length(description) <= 1000),
  CHECK (visibility IN ('public','private')),
  UNIQUE (owner_profile_id, name)
);
CREATE INDEX IF NOT EXISTS idx_user_lists_owner_order
  ON user_lists(owner_profile_id, sort_order, created_at);
CREATE INDEX IF NOT EXISTS idx_user_lists_public
  ON user_lists(visibility, updated_at DESC);

CREATE TABLE IF NOT EXISTS list_profiles (
  list_id TEXT NOT NULL REFERENCES user_lists(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  added_at TEXT NOT NULL,
  PRIMARY KEY (list_id, profile_id)
);
CREATE INDEX IF NOT EXISTS idx_list_profiles_profile
  ON list_profiles(profile_id, list_id);

CREATE TABLE IF NOT EXISTS list_threads (
  list_id TEXT NOT NULL REFERENCES user_lists(id) ON DELETE CASCADE,
  thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  added_at TEXT NOT NULL,
  PRIMARY KEY (list_id, thread_id)
);
CREATE INDEX IF NOT EXISTS idx_list_threads_thread
  ON list_threads(thread_id, list_id);

CREATE TABLE IF NOT EXISTS bookmarks (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  CHECK (target_type IN ('thread','thread_post','social_post')),
  CHECK (length(note) <= 1000),
  UNIQUE (profile_id, target_type, target_id)
);
CREATE INDEX IF NOT EXISTS idx_bookmarks_profile_created
  ON bookmarks(profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bookmarks_target
  ON bookmarks(target_type, target_id);

CREATE TABLE IF NOT EXISTS reactions (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK (target_type IN ('social_post','thread_post')),
  CHECK (kind IN ('like','dislike')),
  UNIQUE (profile_id, target_type, target_id)
);
CREATE INDEX IF NOT EXISTS idx_reactions_target_kind
  ON reactions(target_type, target_id, kind);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  receiver_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  actor_profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  notification_type TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  text TEXT NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  CHECK (notification_type IN ('social_reply','social_repost','social_reaction','social_bookmark','thread_reply','message_received','followed','system')),
  CHECK (target_type IN ('social_post','profile','thread','thread_post','message_conversation','system')),
  CHECK (is_read IN (0, 1)),
  CHECK (length(text) <= 1000)
);
CREATE INDEX IF NOT EXISTS idx_notifications_receiver_unread
  ON notifications(receiver_profile_id, is_read, created_at DESC);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  is_e2ee INTEGER NOT NULL DEFAULT 1,
  verification_status TEXT NOT NULL DEFAULT 'unverified',
  fingerprint TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  last_message_at TEXT NOT NULL,
  CHECK (is_e2ee IN (0, 1)),
  CHECK (verification_status IN ('verified','unverified')),
  CHECK (length(fingerprint) <= 512)
);
CREATE INDEX IF NOT EXISTS idx_conversations_last_message
  ON conversations(last_message_at DESC);

CREATE TABLE IF NOT EXISTS conversation_participants (
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  unread_count INTEGER NOT NULL DEFAULT 0,
  joined_at TEXT NOT NULL,
  last_read_at TEXT,
  PRIMARY KEY (conversation_id, profile_id),
  CHECK (unread_count >= 0)
);
CREATE INDEX IF NOT EXISTS idx_conversation_participants_profile
  ON conversation_participants(profile_id, conversation_id);

CREATE TABLE IF NOT EXISTS direct_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  encrypted_payload TEXT NOT NULL,
  preview_text TEXT NOT NULL DEFAULT '',
  encryption_version TEXT NOT NULL,
  encryption_state TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK (length(encrypted_payload) > 0),
  CHECK (length(preview_text) <= 280),
  CHECK (length(encryption_version) BETWEEN 1 AND 40),
  CHECK (encryption_state IN ('sealed','draft'))
);
CREATE INDEX IF NOT EXISTS idx_direct_messages_conversation_created
  ON direct_messages(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_direct_messages_sender_created
  ON direct_messages(sender_profile_id, created_at DESC);

CREATE TABLE IF NOT EXISTS token_rankings (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  symbol TEXT NOT NULL COLLATE NOCASE,
  network TEXT NOT NULL,
  contract_address TEXT,
  description TEXT NOT NULL DEFAULT '',
  created_by_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  CHECK (length(title) BETWEEN 1 AND 120),
  CHECK (length(symbol) BETWEEN 1 AND 32),
  CHECK (length(network) BETWEEN 1 AND 80),
  CHECK (contract_address IS NULL OR length(contract_address) <= 256),
  CHECK (length(description) <= 2000)
);
CREATE INDEX IF NOT EXISTS idx_token_rankings_symbol
  ON token_rankings(symbol, network);
CREATE INDEX IF NOT EXISTS idx_token_rankings_created
  ON token_rankings(created_at DESC);

-- Balances are Hub-local display data. No wallet address or cross-service
-- account mapping is stored.
CREATE TABLE IF NOT EXISTS token_balances (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL COLLATE NOCASE,
  amount REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (profile_id, symbol),
  CHECK (length(symbol) BETWEEN 1 AND 32),
  CHECK (amount >= 0)
);
CREATE INDEX IF NOT EXISTS idx_token_balances_symbol_amount
  ON token_balances(symbol, amount DESC);

-- Article storage is intentionally Hubpedia-local and contains no publisher
-- identity beyond an optional Hub pseudonymous profile.
CREATE TABLE IF NOT EXISTS hubpedia_articles (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL COLLATE NOCASE UNIQUE,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  author_profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_at TEXT,
  CHECK (length(slug) BETWEEN 1 AND 160),
  CHECK (length(title) BETWEEN 1 AND 240),
  CHECK (length(summary) <= 1000),
  CHECK (length(body) <= 1000000),
  CHECK (length(category) <= 100),
  CHECK (status IN ('draft','published','archived')),
  CHECK ((status = 'published' AND published_at IS NOT NULL) OR status <> 'published')
);
CREATE INDEX IF NOT EXISTS idx_hubpedia_articles_status_published
  ON hubpedia_articles(status, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_hubpedia_articles_category
  ON hubpedia_articles(category, published_at DESC);

-- FTS5 external-content indexes. Triggers keep each index in sync without
-- duplicating application write paths.
CREATE VIRTUAL TABLE IF NOT EXISTS profiles_fts USING fts5(
  handle,
  display_name,
  bio,
  content='profiles',
  content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);
CREATE TRIGGER IF NOT EXISTS profiles_fts_ai AFTER INSERT ON profiles BEGIN
  INSERT INTO profiles_fts(rowid, handle, display_name, bio)
  VALUES (new.rowid, new.handle, new.display_name, new.bio);
END;
CREATE TRIGGER IF NOT EXISTS profiles_fts_ad AFTER DELETE ON profiles BEGIN
  INSERT INTO profiles_fts(profiles_fts, rowid, handle, display_name, bio)
  VALUES ('delete', old.rowid, old.handle, old.display_name, old.bio);
END;
CREATE TRIGGER IF NOT EXISTS profiles_fts_au AFTER UPDATE ON profiles BEGIN
  INSERT INTO profiles_fts(profiles_fts, rowid, handle, display_name, bio)
  VALUES ('delete', old.rowid, old.handle, old.display_name, old.bio);
  INSERT INTO profiles_fts(rowid, handle, display_name, bio)
  VALUES (new.rowid, new.handle, new.display_name, new.bio);
END;

CREATE VIRTUAL TABLE IF NOT EXISTS threads_fts USING fts5(
  title,
  content='threads',
  content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);
CREATE TRIGGER IF NOT EXISTS threads_fts_ai AFTER INSERT ON threads BEGIN
  INSERT INTO threads_fts(rowid, title) VALUES (new.rowid, new.title);
END;
CREATE TRIGGER IF NOT EXISTS threads_fts_ad AFTER DELETE ON threads BEGIN
  INSERT INTO threads_fts(threads_fts, rowid, title)
  VALUES ('delete', old.rowid, old.title);
END;
CREATE TRIGGER IF NOT EXISTS threads_fts_au AFTER UPDATE ON threads BEGIN
  INSERT INTO threads_fts(threads_fts, rowid, title)
  VALUES ('delete', old.rowid, old.title);
  INSERT INTO threads_fts(rowid, title) VALUES (new.rowid, new.title);
END;

CREATE VIRTUAL TABLE IF NOT EXISTS thread_posts_fts USING fts5(
  display_name,
  body,
  content='thread_posts',
  content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);
CREATE TRIGGER IF NOT EXISTS thread_posts_fts_ai AFTER INSERT ON thread_posts BEGIN
  INSERT INTO thread_posts_fts(rowid, display_name, body)
  VALUES (new.rowid, new.display_name, new.body);
END;
CREATE TRIGGER IF NOT EXISTS thread_posts_fts_ad AFTER DELETE ON thread_posts BEGIN
  INSERT INTO thread_posts_fts(thread_posts_fts, rowid, display_name, body)
  VALUES ('delete', old.rowid, old.display_name, old.body);
END;
CREATE TRIGGER IF NOT EXISTS thread_posts_fts_au AFTER UPDATE ON thread_posts BEGIN
  INSERT INTO thread_posts_fts(thread_posts_fts, rowid, display_name, body)
  VALUES ('delete', old.rowid, old.display_name, old.body);
  INSERT INTO thread_posts_fts(rowid, display_name, body)
  VALUES (new.rowid, new.display_name, new.body);
END;

CREATE VIRTUAL TABLE IF NOT EXISTS social_posts_fts USING fts5(
  display_name,
  handle,
  body,
  content='social_posts',
  content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);
CREATE TRIGGER IF NOT EXISTS social_posts_fts_ai AFTER INSERT ON social_posts BEGIN
  INSERT INTO social_posts_fts(rowid, display_name, handle, body)
  VALUES (new.rowid, new.display_name, coalesce(new.handle, ''), new.body);
END;
CREATE TRIGGER IF NOT EXISTS social_posts_fts_ad AFTER DELETE ON social_posts BEGIN
  INSERT INTO social_posts_fts(social_posts_fts, rowid, display_name, handle, body)
  VALUES ('delete', old.rowid, old.display_name, coalesce(old.handle, ''), old.body);
END;
CREATE TRIGGER IF NOT EXISTS social_posts_fts_au AFTER UPDATE ON social_posts BEGIN
  INSERT INTO social_posts_fts(social_posts_fts, rowid, display_name, handle, body)
  VALUES ('delete', old.rowid, old.display_name, coalesce(old.handle, ''), old.body);
  INSERT INTO social_posts_fts(rowid, display_name, handle, body)
  VALUES (new.rowid, new.display_name, coalesce(new.handle, ''), new.body);
END;

CREATE VIRTUAL TABLE IF NOT EXISTS hubpedia_articles_fts USING fts5(
  title,
  summary,
  body,
  category,
  content='hubpedia_articles',
  content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);
CREATE TRIGGER IF NOT EXISTS hubpedia_articles_fts_ai AFTER INSERT ON hubpedia_articles BEGIN
  INSERT INTO hubpedia_articles_fts(rowid, title, summary, body, category)
  VALUES (new.rowid, new.title, new.summary, new.body, new.category);
END;
CREATE TRIGGER IF NOT EXISTS hubpedia_articles_fts_ad AFTER DELETE ON hubpedia_articles BEGIN
  INSERT INTO hubpedia_articles_fts(hubpedia_articles_fts, rowid, title, summary, body, category)
  VALUES ('delete', old.rowid, old.title, old.summary, old.body, old.category);
END;
CREATE TRIGGER IF NOT EXISTS hubpedia_articles_fts_au AFTER UPDATE ON hubpedia_articles BEGIN
  INSERT INTO hubpedia_articles_fts(hubpedia_articles_fts, rowid, title, summary, body, category)
  VALUES ('delete', old.rowid, old.title, old.summary, old.body, old.category);
  INSERT INTO hubpedia_articles_fts(rowid, title, summary, body, category)
  VALUES (new.rowid, new.title, new.summary, new.body, new.category);
END;
