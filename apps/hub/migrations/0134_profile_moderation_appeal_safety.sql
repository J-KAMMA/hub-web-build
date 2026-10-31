PRAGMA foreign_keys = ON;

DELETE FROM moderation_appeals
WHERE status = 'open'
  AND EXISTS (
    SELECT 1
    FROM moderation_appeals AS older
    WHERE older.profile_id = moderation_appeals.profile_id
      AND older.status = 'open'
      AND (
        older.created_at < moderation_appeals.created_at
        OR (older.created_at = moderation_appeals.created_at AND older.id < moderation_appeals.id)
      )
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_moderation_appeals_one_open
  ON moderation_appeals(profile_id)
  WHERE status = 'open';

CREATE TRIGGER IF NOT EXISTS moderation_appeal_rate_limit
BEFORE INSERT ON moderation_appeals
WHEN (
  SELECT COUNT(*)
  FROM moderation_appeals
  WHERE profile_id = NEW.profile_id
    AND created_at >= datetime('now', '-30 days')
) >= 3
BEGIN
  SELECT RAISE(ABORT, 'appeal_rate_limit');
END;
