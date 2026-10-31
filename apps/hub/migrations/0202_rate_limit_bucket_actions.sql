-- hub_rate_limit_buckets の CHECK が thread_create / thread_reply の2つしか許さず、
-- フォローの利用制限（social_follow、lib/thread-abuse-controls.ts）が
-- SQLITE_CONSTRAINT_CHECK で落ちて、/api/follows/toggle が全件400だった。
-- SQLite は CHECK を後から変えられないので、表を作り直して中身を移す。
-- social_post は別の表（hub_social_post_rate_limit_buckets）のまま。

CREATE TABLE IF NOT EXISTS hub_rate_limit_buckets_v2 (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  window_started_at TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 1,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (profile_id, action, window_started_at),
  CHECK (action IN ('thread_create','thread_reply','social_follow')),
  CHECK (request_count > 0)
);

INSERT OR IGNORE INTO hub_rate_limit_buckets_v2 (profile_id, action, window_started_at, request_count, expires_at)
  SELECT profile_id, action, window_started_at, request_count, expires_at FROM hub_rate_limit_buckets;

DROP INDEX IF EXISTS idx_hub_rate_limit_buckets_expiry;
DROP TABLE hub_rate_limit_buckets;
ALTER TABLE hub_rate_limit_buckets_v2 RENAME TO hub_rate_limit_buckets;

CREATE INDEX IF NOT EXISTS idx_hub_rate_limit_buckets_expiry
  ON hub_rate_limit_buckets(expires_at);
