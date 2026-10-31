PRAGMA foreign_keys = OFF;

-- SQLite rewrote this trigger to the temporary notification table name during
-- migration 0138. Drop the stale definition before rebuilding an unrelated
-- table, then restore it against the canonical notifications table below.
DROP TRIGGER IF EXISTS hubpedia_notify_watchers_after_publication;

CREATE TABLE account_profile_links_next (
  pairwise_subject TEXT NOT NULL,
  profile_id TEXT NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
  linked_at TEXT NOT NULL,
  last_authenticated_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL,
  PRIMARY KEY (pairwise_subject, profile_id),
  CHECK (length(pairwise_subject) BETWEEN 32 AND 128)
);

INSERT INTO account_profile_links_next (
  pairwise_subject, profile_id, linked_at, last_authenticated_at, last_used_at
)
SELECT pairwise_subject, profile_id, linked_at, last_authenticated_at, last_authenticated_at
FROM account_profile_links;

DROP TABLE account_profile_links;
ALTER TABLE account_profile_links_next RENAME TO account_profile_links;
CREATE INDEX idx_account_profile_links_subject_recent
  ON account_profile_links(pairwise_subject, last_used_at DESC);

CREATE TABLE hub_profile_contexts (
  profile_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  profile_kind TEXT NOT NULL DEFAULT 'online',
  label TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (profile_kind IN ('real_world', 'online', 'organization')),
  CHECK (length(label) <= 40)
);

CREATE TRIGGER hubpedia_notify_watchers_after_publication
AFTER UPDATE OF current_revision_id ON encyclopedia_articles
WHEN NEW.status = 'published'
  AND NEW.current_revision_id IS NOT NULL
  AND NEW.current_revision_id IS NOT OLD.current_revision_id
BEGIN
  INSERT INTO notifications(
    id, receiver_profile_id, actor_profile_id, notification_type,
    target_type, target_id, text, is_read, created_at
  )
  SELECT
    lower(hex(randomblob(16))),
    watches.profile_id,
    NULL,
    'system',
    'system',
    NEW.slug,
    'ウォッチ中のHubpedia記事が更新されました。',
    0,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM hubpedia_wiki_watches AS watches
  JOIN hubpedia_wiki_articles AS wiki
    ON wiki.article_key = watches.article_key
  WHERE wiki.slug = NEW.slug;
END;

PRAGMA foreign_keys = ON;
