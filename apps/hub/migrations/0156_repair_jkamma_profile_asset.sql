-- Repair the current Hub profile left on the retired PNG path by migration 0103.
-- The old-path predicate preserves any avatar the owner selected afterward.
UPDATE profiles
SET avatar_url = '/jkamma-profile.avif',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE handle IN ('sekai_admin', 'jkamma')
  AND avatar_url = '/jkamma-profile.png';
