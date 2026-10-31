import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { CreatorCenter } from "@/components/creator-center";
import { V2PanelPage } from "@/components/v2/v2-panel-page";
import type { CreatorActivityPeriod } from "@/lib/creator-activity-period";
import { getD1CreatorActivitySummary } from "@/lib/server/d1-creator-center";
import { getD1CreatorRevenueSummary } from "@/lib/server/d1-creator-revenue";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { getHubViewer } from "@/lib/server/hub-viewer";

import "../v2.css";
import "@/app/v2/v2-luxe.css";
import "@/app/v2/v2-luxe-commerce.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "クリエイターセンター | Hub v2" };

/* クリエイターの活動と収益。既存の CreatorCenter をそのまま（材料の集め方も既存と同じ）。 */
export default async function V2CreatorPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const requested = (await searchParams).period;
  const period: CreatorActivityPeriod = requested === "30d" || requested === "90d" ? requested : "all";
  const viewer = await getHubViewer();
  if (!viewer) redirect("/v2/auth?next=/v2/creator");
  const database = getOptionalHubD1();
  if (!database) throw new Error("Hub revenue database is unavailable.");
  const [revenueSummary, activitySummary] = await Promise.all([
    getD1CreatorRevenueSummary(database, viewer.id),
    getD1CreatorActivitySummary(database, viewer.id, period),
  ]);
  return (
    <V2PanelPage skin="luxe" panelOwnsHeading currentPath="/v2/creator" title="クリエイターセンター">
      <CreatorCenter activitySummary={activitySummary} revenueSummary={revenueSummary} viewerHandle={viewer.handle} period={period} surface="/v2" />
    </V2PanelPage>
  );
}
