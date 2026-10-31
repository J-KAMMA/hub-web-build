import { NextResponse } from "next/server";
import { getHubD1 } from "@/lib/server/hub-d1";

export async function GET() {
  const rows = await getHubD1().prepare(`SELECT cv.id,cv.headline,cv.description,cv.call_to_action callToAction,
    cv.landing_url landingUrl,cv.display_url displayUrl,cv.advertiser_display_name advertiserDisplayName,
    cv.image_asset_path imagePath,cr.format,MIN(r.report_day) firstServedDay,MAX(r.report_day) lastServedDay
    FROM hub_ad_creative_versions cv JOIN hub_ad_creatives cr ON cr.id=cv.creative_id
    JOIN hub_ad_daily_reports r ON r.creative_version_id=cv.id
    WHERE cv.review_status IN ('approved','approved_with_restrictions') AND cr.status IN ('approved','paused')
      AND r.served_count>0
    GROUP BY cv.id ORDER BY lastServedDay DESC LIMIT 200`).all();
  return NextResponse.json({ ads: rows.results }, { headers: { "Cache-Control": "public, max-age=300" } });
}
