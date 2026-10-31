import "server-only";

import type { D1Database } from "@cloudflare/workers-types";
import type { HubAdCandidate, HubAdPlacementRecord, HubAdServeRequest } from "@/lib/hub-ads";

interface PlacementRow {
  id: string; placement_key: string; format: HubAdPlacementRecord["format"]; status: HubAdPlacementRecord["status"];
  maximum_ads_per_page: number; targeting_allowed_json: string;
}

interface CandidateRow {
  advertiser_ref: string; category_key: string;
  campaign_id: string; line_item_id: string; creative_version_id: string; format: HubAdCandidate["format"];
  campaign_status: string; campaign_review_status: string; line_item_status: string; creative_status: string;
  creative_review_status: string; start_at: number; end_at: number; priority: number; pacing_mode: HubAdCandidate["pacingMode"];
  rate_jpy_micros: number; campaign_budget_jpy_micros: number; campaign_spent_jpy_micros: number;
  line_item_budget_jpy_micros: number; line_item_spent_jpy_micros: number; daily_budget_jpy_micros: number | null;
  daily_spent_jpy_micros: number; frequency_cap_count: number | null; frequency_count: number; targeting_rules_json: string;
  optimization_served: number; optimization_viewable: number; optimization_clicked: number;
  recent_served: number; recent_clicked: number; previous_served: number; previous_clicked: number;
  negative_feedback: number; public_reports: number;
  optimization_goal:string;ab_testing_enabled:number;minimum_exploration_percent:number;total_creative_served:number;optimization_conversions:number;placement_performance:number;reservation_boost:number;experience_negative_rate:number;experience_slow_rate:number;experience_ad_density:number;
  headline: string; description: string; image_asset_path: string | null; alt_text: string; call_to_action: string;
  advertiser_display_name: string;
}

function parseObject(value: string): Readonly<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Readonly<Record<string, unknown>> : {};
  } catch { return {}; }
}

function parseArray(value: string): string[] {
  try { const parsed = JSON.parse(value) as unknown; return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed : []; }
  catch { return []; }
}

export async function loadHubAdServeData(
  database: D1Database,
  request: HubAdServeRequest,
  frequencyBucketHash: string,
  now: number,
): Promise<{ adsPaused: boolean; placement: HubAdPlacementRecord | null; candidates: HubAdCandidate[]; recentCreativeVersionIds:string[]; recentAdvertiserRefs:string[]; recentCategoryKeys:string[]; hiddenCreativeVersionIds:string[]; hiddenAdvertiserRefs:string[] }> {
  const dayStart = now - ((now + 9 * 60 * 60 * 1000) % (24 * 60 * 60 * 1000));
  const [controlResult, placementResult, candidatesResult, recentResult, hiddenResult] = await database.batch([
    database.prepare("SELECT ads_paused FROM hub_ad_system_controls WHERE control_key = 'global' LIMIT 1"),
    database.prepare("SELECT id, placement_key, format, status, maximum_ads_per_page, targeting_allowed_json FROM hub_ad_placements WHERE placement_key = ? LIMIT 1").bind(request.placementKey),
    database.prepare(`
      SELECT c.id AS campaign_id,c.advertiser_ref,c.objective AS category_key,li.id AS line_item_id,cv.id AS creative_version_id,cr.format,
        c.status AS campaign_status, c.review_status AS campaign_review_status, li.status AS line_item_status,
        cr.status AS creative_status, cv.review_status AS creative_review_status,
        MAX(c.start_at, li.start_at) AS start_at, MIN(c.end_at, li.end_at) AS end_at,
        li.priority, CASE WHEN COALESCE(os.pacing_mode,li.pacing_mode)='asap' THEN 'asap' ELSE 'even' END pacing_mode, li.rate_jpy_micros,
        c.total_budget_jpy_micros AS campaign_budget_jpy_micros,
        COALESCE((SELECT SUM(bl.amount_jpy_micros) FROM hub_ad_budget_ledger bl WHERE bl.campaign_id = c.id), 0) AS campaign_spent_jpy_micros,
        li.budget_jpy_micros AS line_item_budget_jpy_micros,
        COALESCE((SELECT SUM(bl.amount_jpy_micros) FROM hub_ad_budget_ledger bl WHERE bl.line_item_id = li.id), 0) AS line_item_spent_jpy_micros,
        li.daily_budget_jpy_micros,
        COALESCE((SELECT SUM(bl.amount_jpy_micros) FROM hub_ad_budget_ledger bl WHERE bl.line_item_id = li.id AND bl.occurred_at >= ?), 0) AS daily_spent_jpy_micros,
        li.frequency_cap_count,
        COALESCE((SELECT COUNT(*) FROM hub_ad_measurement_events me WHERE me.line_item_id = li.id AND me.frequency_bucket_hash = ? AND me.event_type = 'served' AND me.occurred_at >= (? - COALESCE(li.frequency_cap_window_seconds, 0) * 1000)), 0) AS frequency_count,
        COALESCE((SELECT SUM(r.served_count) FROM hub_ad_daily_reports r WHERE r.creative_version_id = cv.id AND r.report_day >= date(? / 1000, 'unixepoch', '-14 days')), 0) AS optimization_served,
        COALESCE((SELECT SUM(r.viewable_count) FROM hub_ad_daily_reports r WHERE r.creative_version_id = cv.id AND r.report_day >= date(? / 1000, 'unixepoch', '-14 days')), 0) AS optimization_viewable,
        COALESCE((SELECT SUM(r.clicked_count) FROM hub_ad_daily_reports r WHERE r.creative_version_id = cv.id AND r.report_day >= date(? / 1000, 'unixepoch', '-14 days')), 0) AS optimization_clicked,
        COALESCE((SELECT SUM(r.served_count) FROM hub_ad_daily_reports r WHERE r.creative_version_id=cv.id AND r.report_day>=date(?/1000,'unixepoch','-3 days')),0) recent_served,
        COALESCE((SELECT SUM(r.clicked_count) FROM hub_ad_daily_reports r WHERE r.creative_version_id=cv.id AND r.report_day>=date(?/1000,'unixepoch','-3 days')),0) recent_clicked,
        COALESCE((SELECT SUM(r.served_count) FROM hub_ad_daily_reports r WHERE r.creative_version_id=cv.id AND r.report_day>=date(?/1000,'unixepoch','-14 days') AND r.report_day<date(?/1000,'unixepoch','-3 days')),0) previous_served,
        COALESCE((SELECT SUM(r.clicked_count) FROM hub_ad_daily_reports r WHERE r.creative_version_id=cv.id AND r.report_day>=date(?/1000,'unixepoch','-14 days') AND r.report_day<date(?/1000,'unixepoch','-3 days')),0) previous_clicked,
        COALESCE((SELECT COUNT(*) FROM hub_ad_feedback f WHERE f.creative_version_id=cv.id AND f.occurred_at>=?-1209600000),0) negative_feedback,
        COALESCE((SELECT COUNT(*) FROM hub_ad_public_reports pr WHERE pr.token_id IN (SELECT me.token_id FROM hub_ad_measurement_events me WHERE me.creative_version_id=cv.id) AND pr.created_at>=?-1209600000),0) public_reports,
        CASE WHEN os.optimization_goal IN('click','conversion') THEN os.optimization_goal ELSE 'viewable' END optimization_goal,COALESCE(os.ab_testing_enabled,1) ab_testing_enabled,10 minimum_exploration_percent,
        COALESCE((SELECT SUM(r.served_count) FROM hub_ad_daily_reports r WHERE r.line_item_id=li.id),0) total_creative_served,
        COALESCE((SELECT COUNT(*) FROM hub_ad_conversion_events ce WHERE ce.creative_version_id=cv.id),0) optimization_conversions,
        COALESCE((SELECT (SUM(r.clicked_count)+10.0)/(SUM(r.viewable_count)+1000.0)/0.02 FROM hub_ad_daily_reports r WHERE r.placement_id=p.id AND r.line_item_id=li.id),1) placement_performance,
        CASE WHEN EXISTS(SELECT 1 FROM hub_ad_sponsor_reservations sr WHERE sr.campaign_id=c.id AND sr.placement_id=p.id AND sr.status IN('approved','active') AND sr.start_at<=? AND sr.end_at>?) THEN 1.75 ELSE 1 END reservation_boost,
        COALESCE((SELECT CASE WHEN SUM(ed.ads_served)>=100 THEN (SUM(ed.hidden_count)+SUM(ed.report_count)*3.0)/SUM(ed.ads_served) ELSE 0 END FROM hub_ad_experience_daily ed WHERE ed.placement_id=p.id),0) experience_negative_rate,
        COALESCE((SELECT CASE WHEN SUM(ed.ads_served)>=100 THEN SUM(ed.slow_render_count)*1.0/SUM(ed.ads_served) ELSE 0 END FROM hub_ad_experience_daily ed WHERE ed.placement_id=p.id),0) experience_slow_rate,
        COALESCE((SELECT CASE WHEN SUM(ed.ad_opportunities)>=100 THEN SUM(ed.ads_served)*1.0/SUM(ed.ad_opportunities) ELSE 0.1 END FROM hub_ad_experience_daily ed WHERE ed.placement_id=p.id),0.1) experience_ad_density,
        li.targeting_rules_json, cv.headline, cv.description, cv.image_asset_path, cv.alt_text, cv.call_to_action, cv.advertiser_display_name
      FROM hub_ad_line_items li
      JOIN hub_ad_campaigns c ON c.id = li.campaign_id
      JOIN hub_ad_line_item_placements lip ON lip.line_item_id = li.id
      JOIN hub_ad_placements p ON p.id = lip.placement_id
      JOIN hub_ad_line_item_creatives lic ON lic.line_item_id = li.id
      JOIN hub_ad_creative_versions cv ON cv.id = lic.creative_version_id
      JOIN hub_ad_creatives cr ON cr.id = cv.creative_id AND cr.current_version = cv.version
      LEFT JOIN hub_ad_optimization_settings os ON os.campaign_id=c.id
      WHERE p.placement_key = ?
      ORDER BY li.priority DESC, li.rate_jpy_micros DESC
      LIMIT 100
    `).bind(dayStart,frequencyBucketHash,now,now,now,now,now,now,now,now,now,now,now,now,now,now,request.placementKey),
    database.prepare(`SELECT me.creative_version_id creativeVersionId,c.advertiser_ref advertiserRef,c.objective categoryKey
      FROM hub_ad_measurement_events me JOIN hub_ad_line_items li ON li.id=me.line_item_id JOIN hub_ad_campaigns c ON c.id=li.campaign_id
      WHERE me.frequency_bucket_hash=? AND me.event_type='served' ORDER BY me.occurred_at DESC LIMIT 24`).bind(frequencyBucketHash),
    database.prepare(`SELECT creative_version_id creativeVersionId,advertiser_ref advertiserRef,action FROM hub_ad_feedback
      WHERE frequency_bucket_hash=? AND occurred_at>=? ORDER BY occurred_at DESC LIMIT 200`).bind(frequencyBucketHash,now-30*24*60*60_000),
  ]);

  const control = controlResult.results[0] as { ads_paused?: number } | undefined;
  const placementRow = placementResult.results[0] as unknown as PlacementRow | undefined;
  const placement = placementRow ? {
    id: placementRow.id, placementKey: placementRow.placement_key, format: placementRow.format, status: placementRow.status,
    maximumAdsPerPage: placementRow.maximum_ads_per_page, targetingAllowed: parseArray(placementRow.targeting_allowed_json),
  } : null;
  const candidates = (candidatesResult.results as unknown as CandidateRow[]).map((row) => {
    const totalDuration = Math.max(1, row.end_at - row.start_at);
    const budget = Math.max(1, row.line_item_budget_jpy_micros);
    return {
      advertiserRef:row.advertiser_ref,categoryKey:row.category_key,campaignId: row.campaign_id, lineItemId: row.line_item_id, creativeVersionId: row.creative_version_id, format: row.format,
      campaignStatus: row.campaign_status, campaignReviewStatus: row.campaign_review_status, lineItemStatus: row.line_item_status,
      creativeStatus: row.creative_status, creativeReviewStatus: row.creative_review_status, startAt: row.start_at, endAt: row.end_at,
      priority: row.priority, pacingMode: row.pacing_mode, rateJpyMicros: row.rate_jpy_micros,
      campaignBudgetJpyMicros: row.campaign_budget_jpy_micros, campaignSpentJpyMicros: row.campaign_spent_jpy_micros,
      lineItemBudgetJpyMicros: row.line_item_budget_jpy_micros, lineItemSpentJpyMicros: row.line_item_spent_jpy_micros,
      dailyBudgetJpyMicros: row.daily_budget_jpy_micros ?? undefined, dailySpentJpyMicros: row.daily_spent_jpy_micros,
      expectedSpendRatio: Math.max(0, Math.min(1, (now - row.start_at) / totalDuration)),
      actualSpendRatio: Math.max(0, row.line_item_spent_jpy_micros / budget), frequencyCapCount: row.frequency_cap_count ?? undefined,
      frequencyCount: row.frequency_count, targetingRules: parseObject(row.targeting_rules_json), headline: row.headline,
      optimizationServed: row.optimization_served, optimizationViewable: row.optimization_viewable,
      optimizationClicked: row.optimization_clicked,
      recentServed:row.recent_served,recentClicked:row.recent_clicked,previousServed:row.previous_served,previousClicked:row.previous_clicked,
      negativeFeedback:row.negative_feedback,publicReports:row.public_reports,
      optimizationGoal:row.optimization_goal as HubAdCandidate["optimizationGoal"],abTestingEnabled:row.ab_testing_enabled===1,minimumExplorationPercent:row.minimum_exploration_percent,totalCreativeServed:row.total_creative_served,optimizationConversions:row.optimization_conversions,placementPerformance:Math.max(.5,Math.min(1.5,row.placement_performance)),reservationBoost:row.reservation_boost,experienceNegativeRate:row.experience_negative_rate,experienceSlowRate:row.experience_slow_rate,experienceAdDensity:row.experience_ad_density,
      description: row.description, imagePath: row.image_asset_path ?? undefined, altText: row.alt_text,
      callToAction: row.call_to_action, advertiserDisplayName: row.advertiser_display_name,
    } satisfies HubAdCandidate;
  });
  const recent=recentResult.results as Array<{creativeVersionId:string;advertiserRef:string;categoryKey:string}>;
  const hidden=hiddenResult.results as Array<{creativeVersionId:string;advertiserRef:string;action:string}>;
  return { adsPaused: control?.ads_paused !== 0,placement,candidates,
    recentCreativeVersionIds:recent.slice(0,24).map((row)=>row.creativeVersionId),
    recentAdvertiserRefs:recent.slice(0,16).map((row)=>row.advertiserRef),recentCategoryKeys:recent.slice(0,1).map((row)=>row.categoryKey),
    hiddenCreativeVersionIds:hidden.filter((row)=>row.action!=="hide_advertiser").map((row)=>row.creativeVersionId),
    hiddenAdvertiserRefs:hidden.filter((row)=>row.action==="hide_advertiser").map((row)=>row.advertiserRef) };
}

export async function recordHubAdServed(
  database: D1Database,
  data: { requestId: string; tokenId: string; placementId: string; lineItemId: string; creativeVersionId: string; frequencyBucketHash: string; now: number },
): Promise<void> {
  await database.batch([...["selected", "served"].map((eventType) => database.prepare(`
    INSERT OR IGNORE INTO hub_ad_measurement_events
      (id, request_id, token_id, placement_id, line_item_id, creative_version_id, frequency_bucket_hash, event_type, occurred_at, billable, idempotency_key, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
  `).bind(crypto.randomUUID(), data.requestId, data.tokenId, data.placementId, data.lineItemId, data.creativeVersionId,
    data.frequencyBucketHash, eventType, data.now, `${data.tokenId}:${eventType}`, data.now)),database.prepare(`INSERT INTO hub_ad_experience_daily(report_day,placement_id,page_views,ad_opportunities,ads_served,updated_at) VALUES(date(?/1000,'unixepoch'),?,0,0,1,?) ON CONFLICT(report_day,placement_id) DO UPDATE SET ads_served=ads_served+1,updated_at=excluded.updated_at`).bind(data.now,data.placementId,data.now)]);
}

export async function recordHubAdOpportunity(database:D1Database,placementId:string,now:number){await database.prepare(`INSERT INTO hub_ad_experience_daily(report_day,placement_id,page_views,ad_opportunities,ads_served,updated_at) VALUES(date(?/1000,'unixepoch'),?,1,1,0,?) ON CONFLICT(report_day,placement_id) DO UPDATE SET page_views=page_views+1,ad_opportunities=ad_opportunities+1,updated_at=excluded.updated_at`).bind(now,placementId,now).run();}

export async function recordHubAdMeasurement(
  database: D1Database,
  payload: { tokenId: string; requestId: string; placementId: string; lineItemId: string; creativeVersionId: string },
  eventType: "rendered" | "viewable" | "clicked",
  now: number,
): Promise<boolean> {
  const idempotencyKey = `${payload.tokenId}:${eventType}`;
  const eventStatement = database.prepare(`
    INSERT OR IGNORE INTO hub_ad_measurement_events
      (id, request_id, token_id, placement_id, line_item_id, creative_version_id, event_type, occurred_at, billable, idempotency_key, created_at)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?,
      CASE WHEN ? = 'viewable' AND li.pricing_model = 'viewable_cpm' THEN 1 ELSE 0 END, ?, ?
    FROM hub_ad_line_items li
    JOIN hub_ad_campaigns c ON c.id = li.campaign_id
    JOIN hub_ad_creative_versions cv ON cv.id = ?
    JOIN hub_ad_creatives cr ON cr.id = cv.creative_id
    JOIN hub_ad_system_controls sc ON sc.control_key = 'global'
    WHERE li.id = ? AND sc.ads_paused = 0 AND c.status = 'active' AND c.review_status = 'approved'
      AND li.status = 'active' AND cr.status = 'approved' AND cv.review_status = 'approved'
  `).bind(crypto.randomUUID(), payload.requestId, payload.tokenId, payload.placementId, payload.lineItemId,
    payload.creativeVersionId, eventType, now, eventType, idempotencyKey, now, payload.creativeVersionId, payload.lineItemId);
  if (eventType === "viewable") {
    const ledgerStatement = database.prepare(`
      INSERT OR IGNORE INTO hub_ad_budget_ledger
        (id, campaign_id, line_item_id, entry_type, amount_jpy_micros, idempotency_key, occurred_at, created_at)
      SELECT ?, li.campaign_id, li.id, 'viewable_charge', CAST(li.rate_jpy_micros / 1000 AS INTEGER), ?, ?, ?
      FROM hub_ad_line_items li
      JOIN hub_ad_campaigns c ON c.id = li.campaign_id
      WHERE li.id = ? AND li.pricing_model = 'viewable_cpm'
        AND EXISTS (SELECT 1 FROM hub_ad_measurement_events me WHERE me.idempotency_key = ? AND me.billable = 1)
        AND COALESCE((SELECT SUM(bl.amount_jpy_micros) FROM hub_ad_budget_ledger bl WHERE bl.campaign_id = c.id), 0)
          + CAST(li.rate_jpy_micros / 1000 AS INTEGER) <= c.total_budget_jpy_micros
        AND COALESCE((SELECT SUM(bl.amount_jpy_micros) FROM hub_ad_budget_ledger bl WHERE bl.line_item_id = li.id), 0)
          + CAST(li.rate_jpy_micros / 1000 AS INTEGER) <= li.budget_jpy_micros
    `).bind(crypto.randomUUID(), idempotencyKey, now, now, payload.lineItemId, idempotencyKey);
    const [eventResult] = await database.batch([eventStatement, ledgerStatement]);
    return (eventResult.meta.changes ?? 0) > 0;
  }
  const result = await eventStatement.run();
  return (result.meta.changes ?? 0) > 0;
}

export async function getHubAdLandingUrl(database: D1Database, creativeVersionId: string, lineItemId: string): Promise<string | null> {
  const row = await database.prepare(`
    SELECT cv.landing_url FROM hub_ad_creative_versions cv
    JOIN hub_ad_creatives cr ON cr.id = cv.creative_id
    JOIN hub_ad_line_item_creatives lic ON lic.creative_version_id = cv.id
    JOIN hub_ad_line_items li ON li.id = lic.line_item_id
    JOIN hub_ad_campaigns c ON c.id = li.campaign_id
    JOIN hub_ad_system_controls sc ON sc.control_key = 'global'
    WHERE cv.id = ? AND li.id = ? AND sc.ads_paused = 0 AND cv.review_status = 'approved' AND cr.status = 'approved'
      AND li.status = 'active' AND c.status = 'active' AND c.review_status = 'approved' LIMIT 1
  `).bind(creativeVersionId, lineItemId).first<{ landing_url: string }>();
  return row?.landing_url ?? null;
}

export async function getHubAdClickDestination(database: D1Database, creativeVersionId: string, lineItemId: string) {
  return database.prepare(`SELECT cv.landing_url landingUrl,c.id campaignId FROM hub_ad_creative_versions cv
    JOIN hub_ad_line_item_creatives lic ON lic.creative_version_id=cv.id JOIN hub_ad_line_items li ON li.id=lic.line_item_id
    JOIN hub_ad_campaigns c ON c.id=li.campaign_id JOIN hub_ad_creatives cr ON cr.id=cv.creative_id
    JOIN hub_ad_system_controls sc ON sc.control_key='global' WHERE cv.id=? AND li.id=? AND sc.ads_paused=0
    AND cv.review_status='approved' AND cr.status='approved' AND li.status='active' AND c.status='active'
    AND c.review_status='approved' LIMIT 1`).bind(creativeVersionId,lineItemId).first<{landingUrl:string;campaignId:string}>();
}
