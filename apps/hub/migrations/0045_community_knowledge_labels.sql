ALTER TABLE communities
  ADD COLUMN knowledge_label TEXT NOT NULL DEFAULT '共同ページ'
  CHECK (length(knowledge_label) BETWEEN 1 AND 40);

ALTER TABLE communities
  ADD COLUMN knowledge_description TEXT NOT NULL DEFAULT 'コミュニティの知識をディレクトリで整理する共同ページ'
  CHECK (length(knowledge_description) BETWEEN 1 AND 160);

UPDATE communities
SET knowledge_label = '攻略',
    knowledge_description = 'クエストやビルド情報を共同編集する攻略ページ'
WHERE id = 'community-fallout4';

UPDATE communities
SET knowledge_label = '制作Wiki',
    knowledge_description = '設計、材料、制作手順を共同編集するページ'
WHERE id = 'community-makers';
