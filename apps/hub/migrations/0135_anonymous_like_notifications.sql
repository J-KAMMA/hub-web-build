PRAGMA foreign_keys = ON;

-- Positive reactions are intentionally anonymous to the recipient. Keep the
-- actor available only transiently for block, suspension, and self-action
-- checks; it must not remain in the notification record.
UPDATE notifications
SET actor_profile_id = NULL
WHERE notification_type = 'social_reaction'
  AND actor_profile_id IS NOT NULL;

-- Older video-comment like notifications used the actor profile identifier as
-- part of a system-notification dedupe key. They cannot be safely rewritten
-- without creating ambiguous duplicates, so retire those historical rows.
DELETE FROM notifications
WHERE notification_type = 'system'
  AND target_type = 'system'
  AND target_id LIKE '/videos/%#event=video-comment-like:%';
