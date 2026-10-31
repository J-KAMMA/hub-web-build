-- 他のハブから ActivityPub の Flag で届いた通報。運営者の通報キュー（unified-moderation）に出る。
-- 通報者は個人ではなく送信元のハブ（host）。Hub の利用者の通報とは別の表にして、
-- 自動保留（3人以上の通報）には数えない。外のハブの通報だけで投稿が消えないようにするため。
CREATE TABLE IF NOT EXISTS remote_flag_reports (
  id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL,
  source_host TEXT NOT NULL CHECK (length(source_host) BETWEEN 1 AND 255),
  target_kind TEXT NOT NULL CHECK (target_kind IN ('post', 'profile')),
  target_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('image_safety', 'sexual', 'violence', 'copyright', 'privacy', 'harassment', 'spam', 'other')),
  details TEXT NOT NULL DEFAULT '' CHECK (length(details) <= 300),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'dismissed', 'actioned')),
  created_at TEXT NOT NULL,
  reviewed_at TEXT,
  UNIQUE (activity_id, target_kind, target_id)
);

CREATE INDEX IF NOT EXISTS idx_remote_flag_reports_queue
  ON remote_flag_reports (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_remote_flag_reports_target
  ON remote_flag_reports (target_kind, target_id, status);
