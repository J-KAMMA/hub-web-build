-- Vault publications use opaque public content IDs for Hub-local social features.
-- No Vault account, wallet, session, or private content data is stored here.

ALTER TABLE bookmarks RENAME TO bookmarks_before_vault;

CREATE TABLE bookmarks (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  CHECK (target_type IN ('thread','thread_post','social_post','vault_content')),
  CHECK (length(note) <= 1000),
  UNIQUE (profile_id, target_type, target_id)
);

INSERT INTO bookmarks (id, profile_id, target_type, target_id, note, created_at)
SELECT id, profile_id, target_type, target_id, note, created_at
FROM bookmarks_before_vault;

DROP TABLE bookmarks_before_vault;

CREATE INDEX idx_bookmarks_profile_created
  ON bookmarks(profile_id, created_at DESC);
CREATE INDEX idx_bookmarks_target
  ON bookmarks(target_type, target_id);

ALTER TABLE reactions RENAME TO reactions_before_vault;

CREATE TABLE reactions (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK (target_type IN ('social_post','thread_post','vault_content')),
  CHECK (kind = 'like'),
  UNIQUE (profile_id, target_type, target_id)
);

INSERT INTO reactions (id, target_type, target_id, profile_id, kind, created_at)
SELECT id, target_type, target_id, profile_id, kind, created_at
FROM reactions_before_vault
WHERE kind = 'like';

DROP TABLE reactions_before_vault;

CREATE INDEX idx_reactions_target_kind
  ON reactions(target_type, target_id, kind);

CREATE TRIGGER reactions_like_only_insert
BEFORE INSERT ON reactions
WHEN NEW.kind <> 'like'
BEGIN
  SELECT RAISE(ABORT, 'Only like reactions are supported.');
END;

CREATE TRIGGER reactions_like_only_update
BEFORE UPDATE OF kind ON reactions
WHEN NEW.kind <> 'like'
BEGIN
  SELECT RAISE(ABORT, 'Only like reactions are supported.');
END;

CREATE TABLE vault_content_reviews (
  id TEXT PRIMARY KEY,
  vault_content_id TEXT NOT NULL,
  author_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (length(vault_content_id) BETWEEN 1 AND 200),
  UNIQUE (vault_content_id, author_profile_id)
);

CREATE INDEX idx_vault_content_reviews_content
  ON vault_content_reviews(vault_content_id, updated_at DESC);
CREATE INDEX idx_vault_content_reviews_author
  ON vault_content_reviews(author_profile_id, updated_at DESC);
