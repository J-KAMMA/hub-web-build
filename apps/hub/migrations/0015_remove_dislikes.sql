-- Hub uses positive-only reactions. Moderation remains available through reports.
DELETE FROM reactions WHERE kind = 'dislike';

CREATE TRIGGER reactions_like_only_insert
BEFORE INSERT ON reactions
WHEN NEW.kind <> 'like'
BEGIN
  SELECT RAISE(ABORT, 'Only like reactions are supported.');
END;

CREATE TRIGGER reactions_like_only_update
BEFORE UPDATE OF kind ON reactions
WHEN NEW.kind <> 'like'
BEGIN
  SELECT RAISE(ABORT, 'Only like reactions are supported.');
END;
