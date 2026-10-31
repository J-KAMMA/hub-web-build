-- Keep the Hub-local public profile branding independent from Identity/Vault.
UPDATE profiles
SET display_name = 'JKamma',
    bio = 'JKammaからのお知らせやおすすめを投稿します。',
    avatar_url = '/jkamma-profile.png',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE handle = 'sekai_admin';
