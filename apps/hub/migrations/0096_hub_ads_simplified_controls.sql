-- Retire advertiser-controlled safety thresholds and unsupported optimization modes.
-- Legacy columns remain for migration compatibility, but delivery uses Hub-owned constants.

UPDATE hub_ad_optimization_settings SET
  pacing_mode = CASE WHEN pacing_mode = 'asap' THEN 'asap' ELSE 'even' END,
  optimization_goal = CASE WHEN optimization_goal IN ('click','conversion') THEN optimization_goal ELSE 'viewable' END,
  minimum_exploration_percent = 10,
  maximum_negative_feedback_rate = 0.02,
  maximum_page_ad_density = 0.125,
  updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000;

UPDATE hub_ad_sponsor_reservations
SET minimum_viewable_impressions = 1,
    updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE minimum_viewable_impressions <> 1;
