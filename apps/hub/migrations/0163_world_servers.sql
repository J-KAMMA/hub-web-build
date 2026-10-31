-- 第三者が建てた3Dワールドのサーバ。
--
-- **建てた人を必ず持つ。** サーバの主は移動の審判なので、その世界に居る間の
-- 位置も発言も全部見える。隠せないので、入る前に「誰のサーバか」を出せるように、
-- 名簿が持ち主を持つ。
--
-- **既定は「待ち」。** 建てた宣言だけで一覧へ出すと、名簿がそのまま撒き場になる。

CREATE TABLE IF NOT EXISTS WorldServer (
  name TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  about TEXT NOT NULL DEFAULT '',
  -- 建てた人。Hub の口座の識別子。
  operatorId TEXT NOT NULL,
  -- 繋ぎ先。wss のみ（形は register() が検める）。
  address TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT '待ち' CHECK (status IN ('待ち', '公開', '停止')),
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

-- 一覧は公開のものだけを引く。
CREATE INDEX IF NOT EXISTS idx_world_server_status ON WorldServer(status, createdAt);
-- 1人が建てられる数を数える。
CREATE INDEX IF NOT EXISTS idx_world_server_operator ON WorldServer(operatorId);
