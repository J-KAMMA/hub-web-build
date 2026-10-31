-- 成人表示のオプトイン。
--
-- Cookieではなくアカウントに持たせる。端末を変えても保たれ、アプリとも共有される。
-- 「いつ有効にしたか」を残すのは、後から問い合わせや通報を受けたときに
-- その利用者が自分で有効にした事実を示せるようにするため。
CREATE TABLE IF NOT EXISTS profile_adult_opt_in (
  profile_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 0,
  -- 最後に有効にした時刻。解除しても消さない（再有効化の履歴が要るため上書きする）
  enabled_at TEXT,
  updated_at TEXT NOT NULL
);
