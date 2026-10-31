-- ゲームの編集提案を、実装が使っている形へ揃える。
--
-- 0069 は proposed_title / proposed_summary … と項目ごとの列で作ったが、
-- 実装は最初から「変更したい項目だけを持つJSON」で書かれていた。
--   投稿   app/api/games/[gameId]/edits/route.ts    → proposed_fields, proposed_by_profile_id へINSERT
--   一覧   app/api/admin/games/route.ts             → proposed_fields をSELECT
--   審査   app/admin/games/page.tsx                 → proposed_fields をSELECT
--   反映   app/api/admin/games/edits/[id]/route.ts  → JSON.parse して COALESCE で部分更新
-- どの列も存在しないため、この機能は投稿も審査も一度も成立していない。
-- /admin/games は "no such column: e.proposed_fields" で500だった。
--
-- 列ごとの形は部分更新と相性が悪い（proposed_title と proposed_summary が
-- NOT NULL なので、1項目だけの提案を保存できない）。実装側の部分JSONが
-- 設計として通っているので、表をそちらへ合わせる。
--
-- 既存行は保全する。ローカルは0件だが、他の環境の行数は確認できないため、
-- 項目ごとの列から同じ意味のJSONを組み立てて引き継ぐ。NULLの項目は
-- json_object に載せず、「提案されなかった項目」として残す。

PRAGMA foreign_keys = OFF;

CREATE TABLE game_guide_edit_proposals_new (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES game_guide_hubs(id) ON DELETE CASCADE,
  proposed_by_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  proposed_fields TEXT NOT NULL DEFAULT '{}',
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at TEXT NOT NULL,
  reviewed_at TEXT,
  reviewed_by_profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  CHECK (length(reason) <= 500),
  CHECK (json_valid(proposed_fields)),
  CHECK ((status = 'pending' AND reviewed_at IS NULL) OR (status <> 'pending' AND reviewed_at IS NOT NULL))
);

INSERT INTO game_guide_edit_proposals_new
  (id, game_id, proposed_by_profile_id, proposed_fields, reason, status, created_at, reviewed_at, reviewed_by_profile_id)
SELECT
  id,
  game_id,
  author_profile_id,
  json_patch(
    '{}',
    json_object(
      'title', proposed_title,
      'summary', proposed_summary,
      'officialUrl', proposed_official_url,
      -- 空文字と空配列は「提案されなかった」とみなす。json_patch がnullの項目を落とす。
      'platforms', json(COALESCE(NULLIF(NULLIF(proposed_platforms, ''), '[]'), 'null')),
      'releaseDate', proposed_release_date,
      -- aliases は反映側の対象外だが、捨てずに持っていく（未知の項目は無視される）。
      'aliases', json(COALESCE(NULLIF(NULLIF(proposed_aliases, ''), '[]'), 'null'))
    )
  ),
  reason,
  status,
  created_at,
  reviewed_at,
  reviewed_by_profile_id
FROM game_guide_edit_proposals;

DROP TABLE game_guide_edit_proposals;

ALTER TABLE game_guide_edit_proposals_new RENAME TO game_guide_edit_proposals;

CREATE INDEX IF NOT EXISTS idx_game_guide_edit_proposals_queue
  ON game_guide_edit_proposals(status, created_at);

CREATE INDEX IF NOT EXISTS idx_game_guide_edit_proposals_game
  ON game_guide_edit_proposals(game_id, status);

PRAGMA foreign_keys = ON;
