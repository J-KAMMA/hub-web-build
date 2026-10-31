-- Community search: a trigram FTS5 index over name, description and category.
--
-- Search used to read the 500 newest communities and filter them in JavaScript, so
-- an older community could never be found. This index lets the database filter
-- before LIMIT (lib/server/fts-trigram.ts, same query side as migration 0298).
--
-- Cost: the backfill reads every row of communities once and writes one FTS row
-- plus its trigram entries per community. Normal writes add one FTS write per
-- communities insert/update/delete. Nothing else is touched.

DROP TRIGGER IF EXISTS communities_fts_ai;
DROP TRIGGER IF EXISTS communities_fts_ad;
DROP TRIGGER IF EXISTS communities_fts_au;
DROP TABLE IF EXISTS communities_fts;
CREATE VIRTUAL TABLE communities_fts USING fts5(
  name,
  description,
  category,
  content='communities',
  content_rowid='rowid',
  tokenize='trigram'
);
CREATE TRIGGER communities_fts_ai AFTER INSERT ON communities BEGIN
  INSERT INTO communities_fts(rowid, name, description, category)
  VALUES (new.rowid, new.name, new.description, new.category);
END;
CREATE TRIGGER communities_fts_ad AFTER DELETE ON communities BEGIN
  INSERT INTO communities_fts(communities_fts, rowid, name, description, category)
  VALUES ('delete', old.rowid, old.name, old.description, old.category);
END;
CREATE TRIGGER communities_fts_au AFTER UPDATE ON communities BEGIN
  INSERT INTO communities_fts(communities_fts, rowid, name, description, category)
  VALUES ('delete', old.rowid, old.name, old.description, old.category);
  INSERT INTO communities_fts(rowid, name, description, category)
  VALUES (new.rowid, new.name, new.description, new.category);
END;
INSERT INTO communities_fts(communities_fts) VALUES ('rebuild');
