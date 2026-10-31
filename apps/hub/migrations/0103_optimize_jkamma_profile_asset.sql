-- Move the Hub-local branded profile to the optimized static asset without
-- changing user-selected avatars or unrelated profiles.
UPDATE profiles
SET avatar_url = '/jkamma-profile.avif',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE handle = 'sekai_admin'
  AND avatar_url = '/jkamma-profile.png';
