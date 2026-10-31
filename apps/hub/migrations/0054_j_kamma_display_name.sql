PRAGMA foreign_keys = ON;

UPDATE profiles
SET handle = 'jkamma',
    display_name = 'J Kamma',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE handle = 'sekai_admin';
