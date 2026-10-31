DELETE FROM post_pushes;

CREATE TRIGGER IF NOT EXISTS post_pushes_retired_insert
BEFORE INSERT ON post_pushes
BEGIN
  SELECT RAISE(ABORT, 'post_pushes_retired');
END;

CREATE TRIGGER IF NOT EXISTS post_pushes_retired_update
BEFORE UPDATE ON post_pushes
BEGIN
  SELECT RAISE(ABORT, 'post_pushes_retired');
END;
