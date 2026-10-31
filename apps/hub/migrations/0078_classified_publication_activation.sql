UPDATE classified_plans
SET monthly_price_yen = 300
WHERE code = 'standard';

ALTER TABLE classified_plan_entitlements ADD COLUMN activated_at TEXT;
ALTER TABLE classified_plan_entitlements ADD COLUMN publication_ends_at TEXT;

UPDATE classified_plan_entitlements
SET activated_at = active_from,
    publication_ends_at = active_until
WHERE activated_at IS NULL;
