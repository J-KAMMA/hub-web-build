-- 著作権の事件（docs/hub-copyright/PLAN.md 4 章・6.1）。
--
-- Hub が持つのは「事件の番号」と「申告者の表示名」まで。申告者の連絡先（名前・メールアドレス）は
-- Rights Desk（apps/rights）だけが持つ。AGENTS.md が Hub にメールアドレスと本名を置くことを禁じているため。
-- 申告者のプロフィールIDは、Hub にログインして申告した場合だけ入り、事件が閉じてから3年で NULL にする。
--
-- 1 つの申告（copyright_cases）に複数の対象（copyright_case_targets）を入れられる。状態は対象ごと。
-- 状態の決まりは lib/copyright-case-state.ts。

-- 問題の版を隠すための印。隠した版は履歴・差分・MCP の履歴に出さず、一つ前の版を公開の版にする。
ALTER TABLE hubpedia_wiki_revisions ADD COLUMN copyright_hidden_at TEXT;
ALTER TABLE encyclopedia_article_revisions ADD COLUMN copyright_hidden_at TEXT;

CREATE TABLE IF NOT EXISTS copyright_cases (
  id TEXT PRIMARY KEY,
  -- Rights Desk の事件番号。Hub 利用者の申告には Hub が採番する（HUB-…）。
  case_number TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL CHECK (source IN ('rights_desk','hub_user','remote_flag','match')),
  -- 投稿者に見せてよい表示名（法人名など）。連絡先ではない。
  claimant_display_name TEXT NOT NULL,
  work_description TEXT NOT NULL,
  claim_basis TEXT NOT NULL,
  route TEXT NOT NULL DEFAULT 'inquiry' CHECK (route IN ('inquiry','immediate')),
  immediate_reason TEXT CHECK (immediate_reason IS NULL OR immediate_reason IN
    ('matches_removed','registered_match_confirmed','whole_commercial_copy')),
  -- Hub にログインして申告した場合だけ。閉じてから3年で NULL（定期処理）。
  reporter_profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  closed_at TEXT,
  CHECK (length(case_number) BETWEEN 3 AND 80),
  CHECK (length(claimant_display_name) BETWEEN 1 AND 120),
  CHECK (length(work_description) BETWEEN 1 AND 2000),
  CHECK (length(claim_basis) BETWEEN 1 AND 2000),
  CHECK ((route = 'immediate') = (immediate_reason IS NOT NULL))
);
-- 申告者IDの保存期限の定期処理（閉じた事件だけを、閉じた順に）。
CREATE INDEX IF NOT EXISTS idx_copyright_cases_reporter_retention
  ON copyright_cases(closed_at) WHERE reporter_profile_id IS NOT NULL AND closed_at IS NOT NULL;
-- 1 人が出せる申告の数の上限を、索引つきで数えるため。
CREATE INDEX IF NOT EXISTS idx_copyright_cases_reporter_created
  ON copyright_cases(reporter_profile_id, created_at DESC) WHERE reporter_profile_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS copyright_case_targets (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES copyright_cases(id) ON DELETE CASCADE,
  -- 持ち主のサービス。Music・Vault の対象は審査の列にだけ置き、Hub の表では隠さない
  -- （運営の判断は Hub が署名し、Rights Desk が持ち主に出す。PLAN 6.5）。
  service TEXT NOT NULL DEFAULT 'hub' CHECK (service IN ('hub','music','vault')),
  target_kind TEXT NOT NULL CHECK (target_kind IN
    ('social_post','social_image','article','hubpedia_revision','video_embed','music_track','vault_content')),
  target_id TEXT NOT NULL,
  -- 投稿者（Hub 内のプロフィールID）。分からない・消えた場合は NULL。
  author_profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  state TEXT NOT NULL DEFAULT 'received' CHECK (state IN
    ('received','inquiry','objected','hidden','final','restored','kept','rejected')),
  inquiry_notified_at TEXT,
  inquiry_deadline_at TEXT,
  hidden_at TEXT,
  final_at TEXT,
  restored_at TEXT,
  closed_at TEXT,
  -- 非公開にしたあとに投稿者の異議が出ていて、運営の判断待ちか。1 の間は自動では確定しない。
  objection_open INTEGER NOT NULL DEFAULT 0 CHECK (objection_open IN (0,1)),
  -- 復元に必要な、非公開にする前の状態（JSON）。本文や連絡先は入れない。
  restore_data TEXT CHECK (restore_data IS NULL OR (json_valid(restore_data) AND length(restore_data) <= 1000)),
  -- Music・Vault の対象：運営が判断して署名した操作のうち、まだ持ち主に反映が確かめられていないもの。
  -- 反映は Rights Desk への rights.read で確かめ、確かめられたら消す。5xx・未設定のときは定期処理が新しい署名でやり直す。
  pending_action TEXT CHECK (pending_action IS NULL OR pending_action IN ('open','hide','object','restore','finalize','close')),
  pending_params TEXT CHECK (pending_params IS NULL OR (json_valid(pending_params) AND length(pending_params) <= 1000)),
  service_synced_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (case_id, target_kind, target_id),
  CHECK ((service = 'hub') = (target_kind NOT IN ('music_track','vault_content'))),
  CHECK (length(target_id) BETWEEN 1 AND 200),
  CHECK (state <> 'inquiry' OR inquiry_deadline_at IS NOT NULL)
);
-- 7日の経過で非公開にする定期処理。照会中の行だけを締切順に。
CREATE INDEX IF NOT EXISTS idx_copyright_case_targets_inquiry_due
  ON copyright_case_targets(inquiry_deadline_at) WHERE state = 'inquiry';
-- 14日の経過で確定する定期処理。異議が出ていない非公開の行だけを、非公開にした順に。
CREATE INDEX IF NOT EXISTS idx_copyright_case_targets_hidden_due
  ON copyright_case_targets(hidden_at) WHERE state = 'hidden' AND objection_open = 0;
-- 対象ごとの引き当て（復元の前に、ほかの事件が同じ対象を隠していないかを見る）。
CREATE INDEX IF NOT EXISTS idx_copyright_case_targets_target
  ON copyright_case_targets(target_kind, target_id, state);
CREATE INDEX IF NOT EXISTS idx_copyright_case_targets_pending
  ON copyright_case_targets(updated_at) WHERE pending_action IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_copyright_case_targets_case
  ON copyright_case_targets(case_id);
-- 運営の列と、状態ごとの一覧。
CREATE INDEX IF NOT EXISTS idx_copyright_case_targets_queue
  ON copyright_case_targets(state, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_copyright_case_targets_author
  ON copyright_case_targets(author_profile_id, created_at DESC) WHERE author_profile_id IS NOT NULL;

-- 投稿者の回答。agree は措置への同意、disagree は照会への「同意しない」、
-- post_hide_objection は非公開にしたあとの異議。本文は 20〜2000 字（同意は空でもよい）。
CREATE TABLE IF NOT EXISTS copyright_case_responses (
  id TEXT PRIMARY KEY,
  target_id TEXT NOT NULL REFERENCES copyright_case_targets(id) ON DELETE CASCADE,
  author_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('agree','disagree','post_hide_objection')),
  body TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE (target_id, kind),
  CHECK (length(body) <= 2000),
  CHECK (kind = 'agree' OR length(body) >= 20)
);

-- 追記だけの記録（更新・削除はトリガーで拒む）。本文は写さない。対象は種類とIDだけ。
CREATE TABLE IF NOT EXISTS copyright_case_events (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES copyright_cases(id) ON DELETE CASCADE,
  target_id TEXT REFERENCES copyright_case_targets(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('claimant','author','moderator','system','rights_desk')),
  action TEXT NOT NULL CHECK (length(action) BETWEEN 1 AND 60),
  from_state TEXT,
  to_state TEXT,
  reason TEXT NOT NULL DEFAULT '' CHECK (length(reason) <= 1000),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_copyright_case_events_case
  ON copyright_case_events(case_id, created_at);
CREATE INDEX IF NOT EXISTS idx_copyright_case_events_target
  ON copyright_case_events(target_id, created_at) WHERE target_id IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS copyright_case_events_append_only_update
  BEFORE UPDATE ON copyright_case_events
  BEGIN SELECT RAISE(ABORT, 'copyright_case_events_append_only'); END;
CREATE TRIGGER IF NOT EXISTS copyright_case_events_append_only_delete
  BEFORE DELETE ON copyright_case_events
  BEGIN SELECT RAISE(ABORT, 'copyright_case_events_append_only'); END;

-- Rights Desk の署名つき要求の jti（1 回きり）。ハッシュだけを、有効期限が切れるまで持つ。
CREATE TABLE IF NOT EXISTS copyright_rights_desk_jti (
  jti_hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_copyright_rights_desk_jti_expires ON copyright_rights_desk_jti(expires_at);

-- ---------------------------------------------------------------------------
-- 既存の copyright_notices を新しい表へ写す。
--
-- 旧い「処置」（actioned）は状態の文字を変えるだけで対象を非公開にしていなかった。
-- 申告者には「対応した」と知らせてあるので、そのまま「非公開」とは写さず、received に戻して
-- 運営の列に再び出す（イベントに旧状態を残す）。
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO copyright_cases
  (id, case_number, source, claimant_display_name, work_description, claim_basis, route,
   reporter_profile_id, created_at, updated_at, closed_at)
SELECT n.id,
       'LEGACY-' || n.id,
       'hub_user',
       substr(COALESCE((SELECT p.display_name FROM profiles p WHERE p.id = n.reporter_profile_id), 'Hub利用者'), 1, 120),
       n.work_description,
       n.claim_basis,
       'inquiry',
       n.reporter_profile_id,
       n.created_at,
       n.updated_at,
       CASE WHEN n.status IN ('rejected','restored') THEN n.updated_at ELSE NULL END
FROM copyright_notices n;

INSERT OR IGNORE INTO copyright_case_targets
  (id, case_id, target_kind, target_id, author_profile_id, state, closed_at, created_at, updated_at)
SELECT n.id,
       n.id,
       CASE n.target_type
         WHEN 'social_post' THEN 'social_post'
         WHEN 'social_image' THEN 'social_image'
         WHEN 'video' THEN 'video_embed'
         ELSE 'hubpedia_revision'
       END,
       substr(n.target_id, 1, 200),
       CASE n.target_type
         WHEN 'social_post' THEN (SELECT s.author_profile_id FROM social_posts s WHERE s.id = n.target_id)
         WHEN 'social_image' THEN (SELECT i.owner_profile_id FROM social_post_images i WHERE i.id = n.target_id)
         ELSE NULL
       END,
       CASE n.status
         WHEN 'rejected' THEN 'rejected'
         WHEN 'restored' THEN 'restored'
         WHEN 'countered' THEN 'objected'
         ELSE 'received'
       END,
       CASE WHEN n.status IN ('rejected','restored') THEN n.updated_at ELSE NULL END,
       n.created_at,
       n.updated_at
FROM copyright_notices n;

INSERT OR IGNORE INTO copyright_case_events
  (id, case_id, target_id, role, action, from_state, to_state, reason, created_at)
SELECT 'legacy-' || n.id,
       n.id,
       n.id,
       'system',
       'legacy_import',
       NULL,
       CASE n.status
         WHEN 'rejected' THEN 'rejected'
         WHEN 'restored' THEN 'restored'
         WHEN 'countered' THEN 'objected'
         ELSE 'received'
       END,
       'copyright_notices.status=' || n.status ||
         CASE WHEN n.status = 'actioned' THEN ' (旧「処置」は公開状態を変えていないため、再審査に戻した)' ELSE '' END,
       n.updated_at
FROM copyright_notices n;

-- ---------------------------------------------------------------------------
-- 旧い表は読むだけにする（消さない）。申告者IDの期限なしの保存をやめるため、
-- reporter_profile_id を NULL にできる形へ作り直し、新規の書き込みは拒む。
-- ---------------------------------------------------------------------------
ALTER TABLE copyright_notices RENAME TO copyright_notices_before_0261;

CREATE TABLE copyright_notices (
  id TEXT PRIMARY KEY,
  reporter_profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('social_post','social_image','video','hubpedia')),
  target_id TEXT NOT NULL,
  work_description TEXT NOT NULL,
  claim_basis TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','actioned','rejected','countered','restored')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (length(work_description) BETWEEN 20 AND 2000),
  CHECK (length(claim_basis) BETWEEN 20 AND 2000)
);
INSERT INTO copyright_notices
  (id, reporter_profile_id, target_type, target_id, work_description, claim_basis, status, created_at, updated_at)
SELECT id, reporter_profile_id, target_type, target_id, work_description, claim_basis, status, created_at, updated_at
FROM copyright_notices_before_0261;
DROP TABLE copyright_notices_before_0261;
CREATE INDEX IF NOT EXISTS idx_copyright_notices_queue ON copyright_notices(status, created_at DESC);

CREATE TRIGGER IF NOT EXISTS copyright_notices_read_only
  BEFORE INSERT ON copyright_notices
  BEGIN SELECT RAISE(ABORT, 'copyright_notices_read_only_use_copyright_cases'); END;
