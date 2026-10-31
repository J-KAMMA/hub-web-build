PRAGMA foreign_keys = ON;

-- Preserve the stable board key while making politics a dedicated board.
UPDATE boards
SET title = '政治',
    description = '各国・地域の政策、議会、政党、選挙を出典と対象地域付きで扱う',
    updated_at = CURRENT_TIMESTAMP
WHERE board_key = 'cat08-board03';
