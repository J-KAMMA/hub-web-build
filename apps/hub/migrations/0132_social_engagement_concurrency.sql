ALTER TABLE bookmarks RENAME TO bookmarks_before_community;

CREATE TABLE bookmarks (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  CHECK (target_type IN (
    'thread',
    'thread_post',
    'social_post',
    'community_message',
    'vault_content'
  )),
  CHECK (length(note) <= 1000),
  UNIQUE (profile_id, target_type, target_id)
);

INSERT INTO bookmarks (id, profile_id, target_type, target_id, note, created_at)
SELECT id, profile_id, target_type, target_id, note, created_at
FROM bookmarks_before_community;

DROP TABLE bookmarks_before_community;

CREATE INDEX idx_bookmarks_profile_created
  ON bookmarks(profile_id, created_at DESC);
CREATE INDEX idx_bookmarks_target
  ON bookmarks(target_type, target_id);

ALTER TABLE reactions RENAME TO reactions_before_community;

CREATE TABLE reactions (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK (target_type IN (
    'social_post',
    'thread_post',
    'community_message',
    'vault_content'
  )),
  CHECK (kind = 'like'),
  UNIQUE (profile_id, target_type, target_id)
);

INSERT INTO reactions (id, target_type, target_id, profile_id, kind, created_at)
SELECT id, target_type, target_id, profile_id, kind, created_at
FROM reactions_before_community;

DROP TABLE reactions_before_community;

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

CREATE TRIGGER prevent_concurrent_repost
BEFORE INSERT ON social_posts
WHEN NEW.author_profile_id IS NOT NULL
  AND NEW.repost_of_target_type IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM social_posts existing
    WHERE existing.author_profile_id = NEW.author_profile_id
      AND existing.repost_of_target_type = NEW.repost_of_target_type
      AND existing.repost_of_target_id = NEW.repost_of_target_id
      AND datetime(existing.created_at) > datetime(NEW.created_at, '-24 hours')
  )
BEGIN
  SELECT RAISE(ABORT, 'repost_cooldown');
END;
