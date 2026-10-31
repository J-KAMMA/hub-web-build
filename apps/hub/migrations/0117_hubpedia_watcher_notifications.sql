CREATE TRIGGER IF NOT EXISTS hubpedia_notify_watchers_after_publication
AFTER UPDATE OF current_revision_id ON encyclopedia_articles
WHEN NEW.status = 'published'
  AND NEW.current_revision_id IS NOT NULL
  AND NEW.current_revision_id IS NOT OLD.current_revision_id
BEGIN
  INSERT INTO notifications(
    id,
    receiver_profile_id,
    actor_profile_id,
    notification_type,
    target_type,
    target_id,
    text,
    is_read,
    created_at
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
