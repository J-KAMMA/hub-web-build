ALTER TABLE music_works ADD COLUMN tag_signals_json TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(tag_signals_json) AND json_type(tag_signals_json) = 'array');
