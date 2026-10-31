-- 3Dワールドのサーバへの通報。
--
-- **出す前に見る人が居ない形にしたので、出た後に下ろせる必要がある。**
-- 届け出たサーバはそのまま公開になるため、通報だけが歯止めになる。
--
-- **人で数える。** 同じ人が何度押しても1つ（主キーで担保）。数だけで持つと、
-- 1人が繰り返し押して下ろせる道具になる。

CREATE TABLE IF NOT EXISTS WorldServerReport (
  serverName TEXT NOT NULL REFERENCES WorldServer(name) ON DELETE CASCADE,
  -- 通報した人。Hub の口座の識別子。
  reporterId TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  createdAt TEXT NOT NULL,
  PRIMARY KEY (serverName, reporterId)
);

CREATE INDEX IF NOT EXISTS idx_world_server_report ON WorldServerReport(serverName);
