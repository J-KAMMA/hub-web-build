ALTER TABLE hubpedia_articles ADD COLUMN reading TEXT NOT NULL DEFAULT '';
ALTER TABLE hubpedia_articles ADD COLUMN aliases_json TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(aliases_json) AND json_type(aliases_json) = 'array');
ALTER TABLE hubpedia_articles ADD COLUMN category_ids_json TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(category_ids_json) AND json_type(category_ids_json) = 'array');
ALTER TABLE hubpedia_articles ADD COLUMN related_slugs_json TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(related_slugs_json) AND json_type(related_slugs_json) = 'array');

DROP TRIGGER IF EXISTS hubpedia_articles_fts_ai;
DROP TRIGGER IF EXISTS hubpedia_articles_fts_ad;
DROP TRIGGER IF EXISTS hubpedia_articles_fts_au;
DROP TABLE IF EXISTS hubpedia_articles_fts;

CREATE VIRTUAL TABLE hubpedia_articles_fts USING fts5(
  title,
  reading,
  aliases_json,
  summary,
  body,
  category,
  content='hubpedia_articles',
  content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);
CREATE TRIGGER hubpedia_articles_fts_ai AFTER INSERT ON hubpedia_articles BEGIN
  INSERT INTO hubpedia_articles_fts(rowid, title, reading, aliases_json, summary, body, category)
  VALUES (new.rowid, new.title, new.reading, new.aliases_json, new.summary, new.body, new.category);
END;
CREATE TRIGGER hubpedia_articles_fts_ad AFTER DELETE ON hubpedia_articles BEGIN
  INSERT INTO hubpedia_articles_fts(hubpedia_articles_fts, rowid, title, reading, aliases_json, summary, body, category)
  VALUES ('delete', old.rowid, old.title, old.reading, old.aliases_json, old.summary, old.body, old.category);
END;
CREATE TRIGGER hubpedia_articles_fts_au AFTER UPDATE ON hubpedia_articles BEGIN
  INSERT INTO hubpedia_articles_fts(hubpedia_articles_fts, rowid, title, reading, aliases_json, summary, body, category)
  VALUES ('delete', old.rowid, old.title, old.reading, old.aliases_json, old.summary, old.body, old.category);
  INSERT INTO hubpedia_articles_fts(rowid, title, reading, aliases_json, summary, body, category)
  VALUES (new.rowid, new.title, new.reading, new.aliases_json, new.summary, new.body, new.category);
END;

INSERT INTO hubpedia_articles_fts(hubpedia_articles_fts) VALUES ('rebuild');
