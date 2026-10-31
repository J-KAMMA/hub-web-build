-- D1 cannot transact with R2. A deterministic object key makes R2 writes
-- safely repeatable, while this receipt binds the D1 asset and API response.

CREATE TABLE IF NOT EXISTS hub_ad_asset_upload_receipts (
  scope TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  execution_token TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  advertiser_ref TEXT NOT NULL,
  original_sha256 TEXT NOT NULL CHECK(length(original_sha256) = 64),
  response_status INTEGER NOT NULL CHECK(response_status IN (200, 202, 422)),
  response_json TEXT NOT NULL CHECK(json_valid(response_json)),
  occurred_at INTEGER NOT NULL,
  PRIMARY KEY(scope, idempotency_key),
  FOREIGN KEY(scope, idempotency_key)
    REFERENCES hub_ad_admin_idempotency(scope, idempotency_key),
  FOREIGN KEY(asset_id) REFERENCES hub_ad_image_assets(id)
);

CREATE INDEX IF NOT EXISTS idx_hub_ad_asset_upload_receipts_asset
  ON hub_ad_asset_upload_receipts(asset_id, occurred_at DESC);

CREATE TRIGGER IF NOT EXISTS trg_hub_ad_asset_upload_receipt_immutable_update
BEFORE UPDATE ON hub_ad_asset_upload_receipts
BEGIN
  SELECT RAISE(ABORT, 'hub_ad_asset_upload_receipt_immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_hub_ad_asset_upload_receipt_immutable_delete
BEFORE DELETE ON hub_ad_asset_upload_receipts
BEGIN
  SELECT RAISE(ABORT, 'hub_ad_asset_upload_receipt_immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_hub_ad_asset_upload_atomic_completion
BEFORE UPDATE OF state,response_status,response_json ON hub_ad_admin_idempotency
WHEN OLD.state='processing' AND NEW.state='completed'
  AND (OLD.scope='admin.asset.upload.atomic:v1'
    OR OLD.scope LIKE 'advertiser.asset.upload.atomic:v1:%')
BEGIN
  SELECT RAISE(ABORT, 'hub_ad_asset_upload_atomic_graph_incomplete') WHERE NEW.response_status NOT IN (200,202,422) OR NEW.response_json IS NULL OR json_valid(NEW.response_json)=0 OR json_type(NEW.response_json,'$.id')!='text' OR json_type(NEW.response_json,'$.status')!='text';
  SELECT RAISE(ABORT, 'hub_ad_asset_upload_atomic_graph_incomplete') WHERE NOT EXISTS( SELECT 1 FROM hub_ad_asset_upload_receipts r JOIN hub_ad_image_assets a ON a.id=r.asset_id WHERE r.scope=OLD.scope AND r.idempotency_key=OLD.idempotency_key AND r.execution_token=OLD.execution_token AND r.request_hash=OLD.request_hash AND r.response_status=NEW.response_status AND json(r.response_json)=json(NEW.response_json) AND r.asset_id=json_extract(NEW.response_json,'$.id') AND r.advertiser_ref=a.advertiser_ref AND r.original_sha256=a.original_sha256 AND a.quarantine_object_key IS NOT NULL AND ((NEW.response_status=200 AND json_extract(NEW.response_json,'$.status')='clean' AND a.status='clean') OR (NEW.response_status=202 AND json_extract(NEW.response_json,'$.status')='scan_pending' AND a.status IN ('scan_pending','clean','rejected')) OR (NEW.response_status=422 AND json_extract(NEW.response_json,'$.status')='rejected' AND a.status='rejected')) );
END;

