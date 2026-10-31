PRAGMA foreign_keys = ON;

-- 成人層は別ドメインで配信する（AdSenseの対象から jkamma.com を外すため）。
-- 別の登録ドメインなのでCookieもセッションも共有されない。ログイン中の人が
-- 向こうでも同じ人であるために、使い捨ての引き換え券を1枚だけ渡す。
--
-- 券そのものは保存しない。セッションと同じくハッシュだけを持つ。
-- audience を持つのは、盗まれた券を別の宛先で使えないようにするため——
-- 宛先を縛らないと、この券は「どこでもログインできる鍵」になる。
CREATE TABLE IF NOT EXISTS adult_session_handoffs (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  secret_hash TEXT NOT NULL UNIQUE,
  -- 引き換えてよいオリジン。発行時に固定する
  audience TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  -- 一度使ったら二度と使えない。NULLでなくなった時点で失効
  used_at TEXT,
  CHECK (length(secret_hash) >= 32),
  CHECK (expires_at > issued_at),
  CHECK (used_at IS NULL OR used_at >= issued_at)
);

CREATE INDEX IF NOT EXISTS adult_session_handoffs_expires_at
  ON adult_session_handoffs (expires_at);
