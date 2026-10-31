PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS game_guide_hubs (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL COLLATE NOCASE UNIQUE,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  image_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (length(slug) BETWEEN 1 AND 80),
  CHECK (length(title) BETWEEN 1 AND 120)
);

CREATE TABLE IF NOT EXISTS game_guide_community_links (
  game_id TEXT NOT NULL REFERENCES game_guide_hubs(id) ON DELETE CASCADE,
  community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'contributor' CHECK (role IN ('maintainer', 'contributor')),
  linked_at TEXT NOT NULL,
  PRIMARY KEY (game_id, community_id)
);

CREATE INDEX IF NOT EXISTS idx_game_guide_community_links_community
  ON game_guide_community_links(community_id, game_id);

INSERT OR IGNORE INTO game_guide_hubs
  (id, slug, title, summary, image_url, created_at, updated_at)
VALUES
  ('game-fallout-4', 'fallout-4', 'Fallout 4 攻略ハブ',
   '複数のコミュニティが検証したクエスト、ビルド、拠点建築、探索情報を作品単位で整理します。',
   '/community-fallout4.webp', datetime('now'), datetime('now'));

INSERT OR IGNORE INTO game_guide_community_links
  (game_id, community_id, role, linked_at)
SELECT 'game-fallout-4', id, 'maintainer', datetime('now')
FROM communities
WHERE id = 'community-fallout4' OR slug = 'fallout-4';
