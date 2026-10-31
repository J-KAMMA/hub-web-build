-- Gated bodies never enter the search indexes (AGENTS.md: "Gated bodies ... must never enter search indexes").
--
-- Before this migration social_posts_fts and thread_posts_fts indexed every row and the gate was applied only
-- at query time. From here on:
--   * a gated post (content_access_gates target_type='post') has no row in social_posts_fts;
--   * every post of a gated thread (target_type='thread') has no row in thread_posts_fts;
--   * attaching a gate removes the index rows in the same statement; detaching a gate puts them back.
-- Queries keep their notGatedSql() filters as a second wall. Articles and videos have no FTS table (they are
-- searched by LIKE with the gate excluded in SQL); thread titles stay indexed (a locked card shows the title).
--
-- These are external-content tables: a 'delete' command must carry the values that were indexed, and deleting a
-- row that is not in the index corrupts it. So the triggers below only ever delete rows that are indexed, i.e.
-- whose gate state is "not gated", and the gate triggers flip the state exactly once per attach/detach
-- (attach is INSERT ... ON CONFLICT DO UPDATE, which does not fire INSERT triggers on a repeat).
--
-- Apply AFTER 0298 (which rebuilds the indexes from the content tables and so indexes gated rows).
-- A later 'rebuild' of either table re-adds gated rows: run the two purge statements at the end again after it.
--
-- Cost: one pass over the gated posts / posts of gated threads (reads those rows and their gate rows, writes the
-- removal of their trigram entries). Normal writes add one NOT EXISTS lookup on the content_access_gates primary key.

DROP TRIGGER IF EXISTS social_posts_fts_ai;
DROP TRIGGER IF EXISTS social_posts_fts_ad;
DROP TRIGGER IF EXISTS social_posts_fts_au;
CREATE TRIGGER social_posts_fts_ai AFTER INSERT ON social_posts
WHEN NOT EXISTS (SELECT 1 FROM content_access_gates g WHERE g.target_type = 'post' AND g.target_id = new.id)
BEGIN
  INSERT INTO social_posts_fts(rowid, display_name, handle, body)
  VALUES (new.rowid, new.display_name, coalesce(new.handle, ''), new.body);
END;
CREATE TRIGGER social_posts_fts_ad AFTER DELETE ON social_posts
WHEN NOT EXISTS (SELECT 1 FROM content_access_gates g WHERE g.target_type = 'post' AND g.target_id = old.id)
BEGIN
  INSERT INTO social_posts_fts(social_posts_fts, rowid, display_name, handle, body)
  VALUES ('delete', old.rowid, old.display_name, coalesce(old.handle, ''), old.body);
END;
CREATE TRIGGER social_posts_fts_au AFTER UPDATE ON social_posts
WHEN NOT EXISTS (SELECT 1 FROM content_access_gates g WHERE g.target_type = 'post' AND g.target_id = old.id)
BEGIN
  INSERT INTO social_posts_fts(social_posts_fts, rowid, display_name, handle, body)
  VALUES ('delete', old.rowid, old.display_name, coalesce(old.handle, ''), old.body);
  INSERT INTO social_posts_fts(rowid, display_name, handle, body)
  VALUES (new.rowid, new.display_name, coalesce(new.handle, ''), new.body);
END;

DROP TRIGGER IF EXISTS thread_posts_fts_ai;
DROP TRIGGER IF EXISTS thread_posts_fts_ad;
DROP TRIGGER IF EXISTS thread_posts_fts_au;
CREATE TRIGGER thread_posts_fts_ai AFTER INSERT ON thread_posts
WHEN NOT EXISTS (SELECT 1 FROM content_access_gates g WHERE g.target_type = 'thread' AND g.target_id = new.thread_id)
BEGIN
  INSERT INTO thread_posts_fts(rowid, display_name, body)
  VALUES (new.rowid, new.display_name, new.body);
END;
CREATE TRIGGER thread_posts_fts_ad AFTER DELETE ON thread_posts
WHEN NOT EXISTS (SELECT 1 FROM content_access_gates g WHERE g.target_type = 'thread' AND g.target_id = old.thread_id)
BEGIN
  INSERT INTO thread_posts_fts(thread_posts_fts, rowid, display_name, body)
  VALUES ('delete', old.rowid, old.display_name, old.body);
END;
-- The old and new row can sit in different threads (a move), so each half checks its own thread.
CREATE TRIGGER thread_posts_fts_au AFTER UPDATE ON thread_posts
BEGIN
  INSERT INTO thread_posts_fts(thread_posts_fts, rowid, display_name, body)
  SELECT 'delete', old.rowid, old.display_name, old.body
  WHERE NOT EXISTS (SELECT 1 FROM content_access_gates g WHERE g.target_type = 'thread' AND g.target_id = old.thread_id);
  INSERT INTO thread_posts_fts(rowid, display_name, body)
  SELECT new.rowid, new.display_name, new.body
  WHERE NOT EXISTS (SELECT 1 FROM content_access_gates g WHERE g.target_type = 'thread' AND g.target_id = new.thread_id);
END;

-- Attach: take the target's rows out of the index. Detach: put them back.
DROP TRIGGER IF EXISTS content_access_gates_fts_ai;
DROP TRIGGER IF EXISTS content_access_gates_fts_ad;
CREATE TRIGGER content_access_gates_fts_ai AFTER INSERT ON content_access_gates
WHEN new.target_type IN ('post', 'thread')
BEGIN
  INSERT INTO social_posts_fts(social_posts_fts, rowid, display_name, handle, body)
  SELECT 'delete', p.rowid, p.display_name, coalesce(p.handle, ''), p.body FROM social_posts p
  WHERE new.target_type = 'post' AND p.id = new.target_id;
  INSERT INTO thread_posts_fts(thread_posts_fts, rowid, display_name, body)
  SELECT 'delete', tp.rowid, tp.display_name, tp.body FROM thread_posts tp
  WHERE new.target_type = 'thread' AND tp.thread_id = new.target_id;
END;
CREATE TRIGGER content_access_gates_fts_ad AFTER DELETE ON content_access_gates
WHEN old.target_type IN ('post', 'thread')
BEGIN
  INSERT INTO social_posts_fts(rowid, display_name, handle, body)
  SELECT p.rowid, p.display_name, coalesce(p.handle, ''), p.body FROM social_posts p
  WHERE old.target_type = 'post' AND p.id = old.target_id;
  INSERT INTO thread_posts_fts(rowid, display_name, body)
  SELECT tp.rowid, tp.display_name, tp.body FROM thread_posts tp
  WHERE old.target_type = 'thread' AND tp.thread_id = old.target_id;
END;

-- Purge what the previous triggers and the 0298 rebuild indexed while a gate was attached.
INSERT INTO social_posts_fts(social_posts_fts, rowid, display_name, handle, body)
SELECT 'delete', p.rowid, p.display_name, coalesce(p.handle, ''), p.body
FROM content_access_gates g JOIN social_posts p ON p.id = g.target_id
WHERE g.target_type = 'post';

INSERT INTO thread_posts_fts(thread_posts_fts, rowid, display_name, body)
SELECT 'delete', tp.rowid, tp.display_name, tp.body
FROM content_access_gates g JOIN thread_posts tp ON tp.thread_id = g.target_id
WHERE g.target_type = 'thread';
