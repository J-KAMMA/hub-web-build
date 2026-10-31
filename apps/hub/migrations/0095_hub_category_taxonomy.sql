CREATE TABLE IF NOT EXISTS hub_categories (
  id TEXT PRIMARY KEY,
  label_ja TEXT NOT NULL,
  description_ja TEXT NOT NULL,
  position INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))
);

CREATE TABLE IF NOT EXISTS hub_category_mappings (
  surface TEXT NOT NULL,
  source_category TEXT NOT NULL,
  hub_category_id TEXT NOT NULL REFERENCES hub_categories(id) ON DELETE CASCADE,
  confidence INTEGER NOT NULL DEFAULT 100 CHECK(confidence BETWEEN 1 AND 100),
  PRIMARY KEY(surface, source_category, hub_category_id)
);

INSERT OR REPLACE INTO hub_categories(id,label_ja,description_ja,position,active) VALUES
('governance','政治・制度','政治、法律、行政、公共制度',10,1),
('technology','技術・AI','AI、ソフトウェア、インターネット、ものづくり',20,1),
('science','科学・自然','数学、物理、生命、宇宙、環境',30,1),
('culture','文化・創作','本、映画、漫画、芸術、デザイン',40,1),
('economy','経済・仕事','市場、企業、金融、仕事、プロジェクト',50,1),
('community','地域・コミュニティ','地域活動、交流、共同制作',60,1),
('music','音楽','楽曲、アーティスト、演奏、プレイリスト',70,1),
('games','動画・ゲーム','動画、配信、ゲーム、攻略',80,1),
('life','暮らし・健康','健康、食、住まい、美容、育児',90,1),
('sports','スポーツ','競技、運動、アウトドア',100,1),
('world','地域・世界','国、都市、歴史、旅行、地理',110,1);

CREATE INDEX IF NOT EXISTS idx_hub_category_mappings_lookup ON hub_category_mappings(surface, source_category);
