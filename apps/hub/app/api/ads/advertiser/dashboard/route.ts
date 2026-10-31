import { NextResponse } from "next/server";
import { advertiserSessionFromRequest } from "@/lib/server/hub-ads-advertiser-session";
import { getHubD1 } from "@/lib/server/hub-d1";
import { buildHubAdRecommendations, type HubAdCreativeAnalytics } from "@/lib/hub-ads-recommendations";
import { forecastHubAdBudget, type HubAdCampaignBudget } from "@/lib/hub-ads-budget-forecast";
import { describeHubAdCampaignState } from "@/lib/hub-ads-campaign-state";

export async function GET(request: Request) {
  const session = advertiserSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const database = getHubD1();
  const [advertiser, campaigns, creatives, appeals, reports, analytics, comparison] = await database.batch([
    database.prepare("SELECT advertiser_ref advertiserRef,status,policy_version policyVersion,policy_accepted_at policyAcceptedAt FROM hub_ad_advertisers WHERE advertiser_ref=?").bind(session.advertiserRef),
    database.prepare(`SELECT c.id,c.campaign_name campaignName,c.objective,c.status,c.review_status reviewStatus,
      c.total_budget_jpy_micros totalBudgetJpyMicros,c.daily_budget_jpy_micros dailyBudgetJpyMicros,
      c.start_at startAt,c.end_at endAt,
      COALESCE((SELECT SUM(x.credited_jpy_micros) FROM hub_ad_x402_deposits x WHERE x.campaign_id=c.id AND x.status='settled'),0) fundedJpyMicros,
      COALESCE((SELECT SUM(r.spend_jpy_micros) FROM hub_ad_daily_reports r WHERE r.campaign_id=c.id),0) spentJpyMicros,
      COALESCE((SELECT SUM(r.served_count) FROM hub_ad_daily_reports r WHERE r.campaign_id=c.id),0) servedCount,
      COALESCE((SELECT SUM(r.invalid_count) FROM hub_ad_daily_reports r WHERE r.campaign_id=c.id),0) invalidCount,
      COALESCE((SELECT SUM(r.filtered_count) FROM hub_ad_daily_reports r WHERE r.campaign_id=c.id),0) filteredCount,
      COALESCE((SELECT SUM(refund.amount_usdc_atomic) FROM hub_ad_refunds refund
        WHERE refund.campaign_id=c.id AND refund.status IN ('confirmed','recorded')),0) refundedAtomic,
      COALESCE((SELECT SUM(r.spend_jpy_micros) FROM hub_ad_daily_reports r WHERE r.campaign_id=c.id AND r.report_day>=date('now','-7 days')),0) last7dSpendJpyMicros,
      (SELECT json_extract(a.after_json,'$.reason') FROM hub_ad_audit_logs a WHERE a.target_type='campaign' AND a.target_id=c.id
        AND a.action IN ('campaign.needs_changes','campaign.rejected') ORDER BY a.occurred_at DESC LIMIT 1) reviewReason
      FROM hub_ad_campaigns c WHERE c.advertiser_ref=? ORDER BY c.created_at DESC`).bind(session.advertiserRef),
    database.prepare(`SELECT cr.id,cr.status,cr.current_version currentVersion,cr.format,cv.id versionId,cv.headline,cv.description,
      cv.call_to_action callToAction,cv.landing_url landingUrl,cv.advertiser_display_name advertiserDisplayName,
      cv.image_asset_path imagePath,CASE WHEN cv.image_asset_path LIKE '/api/ads/assets/%' THEN substr(cv.image_asset_path,17) END assetId,cv.review_status reviewStatus,
      (SELECT json_extract(a.after_json,'$.reason') FROM hub_ad_audit_logs a WHERE a.target_type='creative' AND a.target_id=cr.id
        AND a.action IN ('creative.needs_changes','creative.rejected') ORDER BY a.occurred_at DESC LIMIT 1) reviewReason
      FROM hub_ad_creatives cr JOIN hub_ad_creative_versions cv ON cv.creative_id=cr.id AND cv.version=cr.current_version
      WHERE cr.advertiser_ref=? ORDER BY cr.created_at DESC`).bind(session.advertiserRef),
    database.prepare(`SELECT id,target_type targetType,target_id targetId,reason,status,resolution_note resolutionNote,created_at createdAt
      FROM hub_ad_review_appeals WHERE advertiser_ref=? ORDER BY created_at DESC LIMIT 100`).bind(session.advertiserRef),
    database.prepare(`SELECT r.report_day reportDay,r.campaign_id campaignId,SUM(r.served_count) served,SUM(r.viewable_count) viewable,
      SUM(r.clicked_count) clicked,SUM(r.invalid_count) invalid,SUM(r.filtered_count) filtered,SUM(r.spend_jpy_micros) spendJpyMicros,
      COALESCE(MAX(cv.conversion_value),0) conversionValueJpyMicros,COALESCE(MAX(cv.conversions),0) conversions
      FROM hub_ad_daily_reports r JOIN hub_ad_campaigns c ON c.id=r.campaign_id
      LEFT JOIN (SELECT campaign_id,date(occurred_at/1000,'unixepoch') report_day,COUNT(*) conversions,
        SUM(COALESCE(value_jpy_micros,0)) conversion_value FROM hub_ad_conversion_events GROUP BY campaign_id,report_day) cv
        ON cv.campaign_id=r.campaign_id AND cv.report_day=r.report_day
      WHERE c.advertiser_ref=? GROUP BY r.report_day,r.campaign_id HAVING SUM(r.served_count)>=100 ORDER BY r.report_day DESC LIMIT 200`).bind(session.advertiserRef),
    database.prepare(`SELECT cv.id creativeVersionId,cv.headline,SUM(r.served_count) served,SUM(r.viewable_count) viewable,SUM(r.clicked_count) clicked,
      COALESCE((SELECT SUM(r2.served_count) FROM hub_ad_daily_reports r2 WHERE r2.creative_version_id=cv.id AND r2.report_day>=date('now','-3 days')),0) recentServed,
      COALESCE((SELECT SUM(r2.clicked_count) FROM hub_ad_daily_reports r2 WHERE r2.creative_version_id=cv.id AND r2.report_day>=date('now','-3 days')),0) recentClicked,
      COALESCE((SELECT SUM(r2.served_count) FROM hub_ad_daily_reports r2 WHERE r2.creative_version_id=cv.id AND r2.report_day>=date('now','-14 days') AND r2.report_day<date('now','-3 days')),0) previousServed,
      COALESCE((SELECT SUM(r2.clicked_count) FROM hub_ad_daily_reports r2 WHERE r2.creative_version_id=cv.id AND r2.report_day>=date('now','-14 days') AND r2.report_day<date('now','-3 days')),0) previousClicked,
      COALESCE((SELECT COUNT(*) FROM hub_ad_feedback f WHERE f.creative_version_id=cv.id),0) negativeFeedback,
      COALESCE((SELECT COUNT(*) FROM hub_ad_public_reports pr WHERE pr.token_id IN(SELECT me.token_id FROM hub_ad_measurement_events me WHERE me.creative_version_id=cv.id)),0) publicReports
      FROM hub_ad_creatives cr JOIN hub_ad_creative_versions cv ON cv.creative_id=cr.id JOIN hub_ad_daily_reports r ON r.creative_version_id=cv.id
      WHERE cr.advertiser_ref=? GROUP BY cv.id,cv.headline HAVING SUM(r.served_count)>=100 ORDER BY served DESC LIMIT 100`).bind(session.advertiserRef),
    database.prepare(`SELECT
      SUM(CASE WHEN r.report_day>=date('now','-7 days') THEN r.served_count ELSE 0 END) currentServed,
      SUM(CASE WHEN r.report_day>=date('now','-7 days') THEN r.clicked_count ELSE 0 END) currentClicked,
      SUM(CASE WHEN r.report_day>=date('now','-7 days') THEN r.spend_jpy_micros ELSE 0 END) currentSpend,
      SUM(CASE WHEN r.report_day>=date('now','-14 days') AND r.report_day<date('now','-7 days') THEN r.served_count ELSE 0 END) previousServed,
      SUM(CASE WHEN r.report_day>=date('now','-14 days') AND r.report_day<date('now','-7 days') THEN r.clicked_count ELSE 0 END) previousClicked,
      SUM(CASE WHEN r.report_day>=date('now','-14 days') AND r.report_day<date('now','-7 days') THEN r.spend_jpy_micros ELSE 0 END) previousSpend
      FROM hub_ad_daily_reports r JOIN hub_ad_campaigns c ON c.id=r.campaign_id WHERE c.advertiser_ref=?`).bind(session.advertiserRef),
  ]);
  const actor = advertiser.results[0];
  if (!actor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const campaignRows = campaigns.results as unknown as Array<Record<string, unknown> & HubAdCampaignBudget & {
    id: string; status: string; reviewStatus: string; endAt: number;
  }>;
  const campaignsWithState = campaignRows.map((campaign) => ({
    ...campaign,
    budgetForecast: forecastHubAdBudget(campaign),
    displayState: describeHubAdCampaignState(campaign),
  }));
  const budgetAlerts = campaignsWithState.flatMap((campaign) => {
    const spent = Number(campaign.spentJpyMicros) || 0, total = Number(campaign.totalBudgetJpyMicros) || 0;
    const ratio = total > 0 ? spent / total : 0;
    return ratio >= .8 ? [{ campaignId: campaign.id, severity: ratio >= 1 ? "critical" : "warning", message: ratio >= 1 ? "予算を使い切りました。" : `予算の${Math.floor(ratio * 100)}%を消化しました。` }] : [];
  });
  const creativeAnalytics = analytics.results as unknown as HubAdCreativeAnalytics[];
  return NextResponse.json({
    advertiser: actor,
    campaigns: campaignsWithState,
    creatives: creatives.results,
    appeals: appeals.results,
    reports: reports.results,
    reportComparison: comparison.results[0] ?? {},
    creativeAnalytics,
    recommendations: buildHubAdRecommendations(creativeAnalytics),
    budgetAlerts,
    privacyThreshold: 100,
  }, { headers: { "Cache-Control": "no-store" } });
}
