-- Search over games, research projects and federated community posts: trigram FTS5 indexes
-- (same query side as migrations 0298 and 0299, lib/server/fts-trigram.ts).
--
--   game_guide_hubs_fts           title, summary, aliases
--   research_projects_fts         title, description
--   remote_community_items_fts    title, body   (posts another Hub announced into a community we joined)
--
-- Cost: the backfill reads every row of the three base tables once (game_guide_hubs +
-- research_projects + remote_community_items) and writes one FTS row plus its trigram entries per
-- row. Normal writes add one FTS write per insert/update/delete on those tables. Nothing else is touched.

-- ===== games =====
DROP TRIGGER IF EXISTS game_guide_hubs_fts_ai;
DROP TRIGGER IF EXISTS game_guide_hubs_fts_ad;
DROP TRIGGER IF EXISTS game_guide_hubs_fts_au;
DROP TABLE IF EXISTS game_guide_hubs_fts;
CREATE VIRTUAL TABLE game_guide_hubs_fts USING fts5(
  title,
  summary,
  aliases,
  content='game_guide_hubs',
  content_rowid='rowid',
  tokenize='trigram'
);
CREATE TRIGGER game_guide_hubs_fts_ai AFTER INSERT ON game_guide_hubs BEGIN
  INSERT INTO game_guide_hubs_fts(rowid, title, summary, aliases)
  VALUES (new.rowid, new.title, new.summary, new.aliases);
END;
CREATE TRIGGER game_guide_hubs_fts_ad AFTER DELETE ON game_guide_hubs BEGIN
  INSERT INTO game_guide_hubs_fts(game_guide_hubs_fts, rowid, title, summary, aliases)
  VALUES ('delete', old.rowid, old.title, old.summary, old.aliases);
END;
CREATE TRIGGER game_guide_hubs_fts_au AFTER UPDATE ON game_guide_hubs BEGIN
  INSERT INTO game_guide_hubs_fts(game_guide_hubs_fts, rowid, title, summary, aliases)
  VALUES ('delete', old.rowid, old.title, old.summary, old.aliases);
  INSERT INTO game_guide_hubs_fts(rowid, title, summary, aliases)
  VALUES (new.rowid, new.title, new.summary, new.aliases);
END;
INSERT INTO game_guide_hubs_fts(game_guide_hubs_fts) VALUES ('rebuild');

-- ===== research projects =====
DROP TRIGGER IF EXISTS research_projects_fts_ai;
DROP TRIGGER IF EXISTS research_projects_fts_ad;
DROP TRIGGER IF EXISTS research_projects_fts_au;
DROP TABLE IF EXISTS research_projects_fts;
CREATE VIRTUAL TABLE research_projects_fts USING fts5(
  title,
  description,
  content='research_projects',
  content_rowid='rowid',
  tokenize='trigram'
);
CREATE TRIGGER research_projects_fts_ai AFTER INSERT ON research_projects BEGIN
  INSERT INTO research_projects_fts(rowid, title, description)
  VALUES (new.rowid, new.title, new.description);
END;
CREATE TRIGGER research_projects_fts_ad AFTER DELETE ON research_projects BEGIN
  INSERT INTO research_projects_fts(research_projects_fts, rowid, title, description)
  VALUES ('delete', old.rowid, old.title, old.description);
END;
CREATE TRIGGER research_projects_fts_au AFTER UPDATE ON research_projects BEGIN
  INSERT INTO research_projects_fts(research_projects_fts, rowid, title, description)
  VALUES ('delete', old.rowid, old.title, old.description);
  INSERT INTO research_projects_fts(rowid, title, description)
  VALUES (new.rowid, new.title, new.description);
END;
INSERT INTO research_projects_fts(research_projects_fts) VALUES ('rebuild');

-- ===== federated community items =====
DROP TRIGGER IF EXISTS remote_community_items_fts_ai;
DROP TRIGGER IF EXISTS remote_community_items_fts_ad;
DROP TRIGGER IF EXISTS remote_community_items_fts_au;
DROP TABLE IF EXISTS remote_community_items_fts;
CREATE VIRTUAL TABLE remote_community_items_fts USING fts5(
  title,
  body,
  content='remote_community_items',
  content_rowid='rowid',
  tokenize='trigram'
);
CREATE TRIGGER remote_community_items_fts_ai AFTER INSERT ON remote_community_items BEGIN
  INSERT INTO remote_community_items_fts(rowid, title, body)
  VALUES (new.rowid, new.title, new.body);
END;
CREATE TRIGGER remote_community_items_fts_ad AFTER DELETE ON remote_community_items BEGIN
  INSERT INTO remote_community_items_fts(remote_community_items_fts, rowid, title, body)
  VALUES ('delete', old.rowid, old.title, old.body);
END;
CREATE TRIGGER remote_community_items_fts_au AFTER UPDATE ON remote_community_items BEGIN
  INSERT INTO remote_community_items_fts(remote_community_items_fts, rowid, title, body)
  VALUES ('delete', old.rowid, old.title, old.body);
  INSERT INTO remote_community_items_fts(rowid, title, body)
  VALUES (new.rowid, new.title, new.body);
END;
INSERT INTO remote_community_items_fts(remote_community_items_fts) VALUES ('rebuild');
