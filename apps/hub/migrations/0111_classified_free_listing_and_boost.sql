-- Ordinary classified publication is free. The existing paid "standard" plan is
-- retained as the versioned code for a seven-day discovery boost so old payment
-- records remain referentially valid.
UPDATE classified_plans
SET name = '7日ブースト',
    monthly_price_yen = 300,
    listing_limit = 1,
    featured_days = 7,
    active = 1
WHERE code = 'standard';

UPDATE classified_plans
SET name = '無料掲載',
    monthly_price_yen = 0,
    listing_limit = 1,
    featured_days = 0,
    active = 1
WHERE code = 'free';

UPDATE classified_listing_prices
SET amount_major = 300,
    renewal_amount_major = 300
WHERE currency = 'JPYC'
  AND kind IN ('real-estate', 'vehicles');

UPDATE classified_listing_prices
SET amount_major = 3,
    renewal_amount_major = 3
WHERE currency = 'USDC'
  AND kind IN ('real-estate', 'vehicles');

-- Paid publication is no longer required. Existing listings keep their plan
-- history, while all newly created listings use the free base plan.
UPDATE classified_listings
SET plan_code = 'free'
WHERE plan_code IS NULL;
