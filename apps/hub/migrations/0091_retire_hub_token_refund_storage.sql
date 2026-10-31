-- Refund and payment records are Commerce-owned. Preserve any legacy rows as
-- read-inaccessible migration evidence, but fail closed against future Hub writes.
CREATE TRIGGER IF NOT EXISTS hub_token_refunds_storage_retired
BEFORE INSERT ON hub_token_refunds
BEGIN
  SELECT RAISE(ABORT, 'commerce_owned_refund_data_forbidden');
END;
