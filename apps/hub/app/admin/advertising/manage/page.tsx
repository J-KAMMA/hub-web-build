import { cookies } from "next/headers";
import { AdvertisingInventoryLogin } from "@/components/advertising-inventory-filter";
import { AdvertisingOperationsConsole } from "@/components/advertising-operations-console";
import { listHubAdPlacements } from "@/lib/server/hub-ads-admin";
import { listHubAdCampaigns, listHubAdCreatives, listHubAdLineItems } from "@/lib/server/hub-ads-campaign-admin";
import { listHubAdAssets } from "@/lib/server/hub-ads-assets";
import { listHubAdReports } from "@/lib/server/hub-ads-reporting";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { isModerationAdminToken, MODERATION_ADMIN_COOKIE } from "@/lib/server/moderation-admin-auth";
import { getHubAdOperationalHealth, listHubAdOperationalAlerts } from "@/lib/server/hub-ads-monitoring";

export const dynamic = "force-dynamic";

export default async function AdvertisingOperationsPage() {
  const cookieStore = await cookies();
  if (!isModerationAdminToken(cookieStore.get(MODERATION_ADMIN_COOKIE)?.value)) {
    return <section className="ad-inventory-page ad-inventory-page--locked"><span>HUB ADS OPERATIONS</span>
      <h1>広告運用管理</h1><p>管理者認証後に広告枠、キャンペーン、素材審査を操作できます。</p><AdvertisingInventoryLogin /></section>;
  }
  const database = getOptionalHubD1();
  const [placements, campaigns, creatives, lineItems, assets, reports, alerts, health] = database
    ? await Promise.all([listHubAdPlacements(database), listHubAdCampaigns(database), listHubAdCreatives(database), listHubAdLineItems(database), listHubAdAssets(database), listHubAdReports(database), listHubAdOperationalAlerts(database), getHubAdOperationalHealth(database)])
    : [[], [], [], [], [], { rows: [], reviews: [], privacyThreshold: 100 }, [], { campaigns: 0, activeCampaigns: 0, pendingReview: 0, pendingAssets: 0, lastReportAt: null }];
  return <AdvertisingOperationsConsole placements={placements} campaigns={campaigns} creatives={creatives} lineItems={lineItems} assets={assets} reports={reports} alerts={alerts} health={health} />;
}
