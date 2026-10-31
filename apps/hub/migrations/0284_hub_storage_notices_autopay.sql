-- 自動更新の知らせ（docs/hub-storage-plans/AUTOPAY.md §7.1）。kind の CHECK を広げるので作り直す。
-- autopay_due: 引き落としの 3 日前。autopay_stopped: 自動更新が止まった。autopay_active: 自動だったことを覚える印（通知ではない）。
CREATE TABLE hub_storage_notices_next (
  profile_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('near_limit', 'at_limit', 'autopay_due', 'autopay_stopped', 'autopay_active')),
  valid_until TEXT NOT NULL,
  PRIMARY KEY (profile_id, kind)
);
INSERT INTO hub_storage_notices_next (profile_id, kind, valid_until)
  SELECT profile_id, kind, valid_until FROM hub_storage_notices;
DROP TABLE hub_storage_notices;
ALTER TABLE hub_storage_notices_next RENAME TO hub_storage_notices;
