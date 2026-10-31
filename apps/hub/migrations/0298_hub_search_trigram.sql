-- Japanese search: replace the unicode61 FTS5 indexes with trigram indexes.
--
-- unicode61 treats an unbroken run of Japanese as one token, so a query for
-- 音楽 could not find 電子音楽の作り方. The trigram tokenizer indexes every
-- three-character window and answers substring queries. It cannot answer terms
-- shorter than three characters; the application resolves those with a bounded
-- instr() pass (lib/server/fts-trigram.ts). Queries fold hiragana/katakana at
-- query time because the index stores the text as typed.
--
-- Same table, trigger and column names as before, so write paths are untouched.
-- Each index is dropped, recreated and rebuilt from its content table.

DROP TRIGGER IF EXISTS profiles_fts_ai;
DROP TRIGGER IF EXISTS profiles_fts_ad;
DROP TRIGGER IF EXISTS profiles_fts_au;
DROP TABLE IF EXISTS profiles_fts;
CREATE VIRTUAL TABLE profiles_fts USING fts5(
  handle,
  display_name,
  bio,
  content='profiles',
  content_rowid='rowid',
  tokenize='trigram'
);
CREATE TRIGGER profiles_fts_ai AFTER INSERT ON profiles BEGIN
  INSERT INTO profiles_fts(rowid, handle, display_name, bio)
  VALUES (new.rowid, new.handle, new.display_name, new.bio);
END;
CREATE TRIGGER profiles_fts_ad AFTER DELETE ON profiles BEGIN
  INSERT INTO profiles_fts(profiles_fts, rowid, handle, display_name, bio)
  VALUES ('delete', old.rowid, old.handle, old.display_name, old.bio);
END;
CREATE TRIGGER profiles_fts_au AFTER UPDATE ON profiles BEGIN
  INSERT INTO profiles_fts(profiles_fts, rowid, handle, display_name, bio)
  VALUES ('delete', old.rowid, old.handle, old.display_name, old.bio);
  INSERT INTO profiles_fts(rowid, handle, display_name, bio)
  VALUES (new.rowid, new.handle, new.display_name, new.bio);
END;
INSERT INTO profiles_fts(profiles_fts) VALUES ('rebuild');

DROP TRIGGER IF EXISTS threads_fts_ai;
DROP TRIGGER IF EXISTS threads_fts_ad;
DROP TRIGGER IF EXISTS threads_fts_au;
DROP TABLE IF EXISTS threads_fts;
CREATE VIRTUAL TABLE threads_fts USING fts5(
  title,
  content='threads',
  content_rowid='rowid',
  tokenize='trigram'
);
CREATE TRIGGER threads_fts_ai AFTER INSERT ON threads BEGIN
  INSERT INTO threads_fts(rowid, title)
  VALUES (new.rowid, new.title);
END;
CREATE TRIGGER threads_fts_ad AFTER DELETE ON threads BEGIN
  INSERT INTO threads_fts(threads_fts, rowid, title)
  VALUES ('delete', old.rowid, old.title);
END;
CREATE TRIGGER threads_fts_au AFTER UPDATE ON threads BEGIN
  INSERT INTO threads_fts(threads_fts, rowid, title)
  VALUES ('delete', old.rowid, old.title);
  INSERT INTO threads_fts(rowid, title)
  VALUES (new.rowid, new.title);
END;
INSERT INTO threads_fts(threads_fts) VALUES ('rebuild');

DROP TRIGGER IF EXISTS thread_posts_fts_ai;
DROP TRIGGER IF EXISTS thread_posts_fts_ad;
DROP TRIGGER IF EXISTS thread_posts_fts_au;
DROP TABLE IF EXISTS thread_posts_fts;
CREATE VIRTUAL TABLE thread_posts_fts USING fts5(
  display_name,
  body,
  content='thread_posts',
  content_rowid='rowid',
  tokenize='trigram'
);
CREATE TRIGGER thread_posts_fts_ai AFTER INSERT ON thread_posts BEGIN
  INSERT INTO thread_posts_fts(rowid, display_name, body)
  VALUES (new.rowid, new.display_name, new.body);
END;
CREATE TRIGGER thread_posts_fts_ad AFTER DELETE ON thread_posts BEGIN
  INSERT INTO thread_posts_fts(thread_posts_fts, rowid, display_name, body)
  VALUES ('delete', old.rowid, old.display_name, old.body);
END;
CREATE TRIGGER thread_posts_fts_au AFTER UPDATE ON thread_posts BEGIN
  INSERT INTO thread_posts_fts(thread_posts_fts, rowid, display_name, body)
  VALUES ('delete', old.rowid, old.display_name, old.body);
  INSERT INTO thread_posts_fts(rowid, display_name, body)
  VALUES (new.rowid, new.display_name, new.body);
END;
INSERT INTO thread_posts_fts(thread_posts_fts) VALUES ('rebuild');

DROP TRIGGER IF EXISTS social_posts_fts_ai;
DROP TRIGGER IF EXISTS social_posts_fts_ad;
DROP TRIGGER IF EXISTS social_posts_fts_au;
DROP TABLE IF EXISTS social_posts_fts;
CREATE VIRTUAL TABLE social_posts_fts USING fts5(
  display_name,
  handle,
  body,
  content='social_posts',
  content_rowid='rowid',
  tokenize='trigram'
);
CREATE TRIGGER social_posts_fts_ai AFTER INSERT ON social_posts BEGIN
  INSERT INTO social_posts_fts(rowid, display_name, handle, body)
  VALUES (new.rowid, new.display_name, coalesce(new.handle, ''), new.body);
END;
CREATE TRIGGER social_posts_fts_ad AFTER DELETE ON social_posts BEGIN
  INSERT INTO social_posts_fts(social_posts_fts, rowid, display_name, handle, body)
  VALUES ('delete', old.rowid, old.display_name, coalesce(old.handle, ''), old.body);
END;
CREATE TRIGGER social_posts_fts_au AFTER UPDATE ON social_posts BEGIN
  INSERT INTO social_posts_fts(social_posts_fts, rowid, display_name, handle, body)
  VALUES ('delete', old.rowid, old.display_name, coalesce(old.handle, ''), old.body);
  INSERT INTO social_posts_fts(rowid, display_name, handle, body)
  VALUES (new.rowid, new.display_name, coalesce(new.handle, ''), new.body);
END;
INSERT INTO social_posts_fts(social_posts_fts) VALUES ('rebuild');

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
  tokenize='trigram'
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
