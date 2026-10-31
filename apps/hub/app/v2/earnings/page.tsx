import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { MonetizationDashboard } from "@/components/monetization-dashboard";
import { V2PanelPage } from "@/components/v2/v2-panel-page";
import { WalletTipHistory } from "@/components/wallet-tip-history";
import { getD1CreatorRevenueSummary } from "@/lib/server/d1-creator-revenue";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { getHubViewer } from "@/lib/server/hub-viewer";

import "../v2.css";
import "../v2-tools.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "収益 | Hub v2" };

/* 収益と投げ銭の履歴。既存の部品をそのまま。 */
export default async function V2EarningsPage() {
  const viewer = await getHubViewer();
  if (!viewer) redirect("/v2/auth?next=/v2/earnings");
  const database = getOptionalHubD1();
  if (!database) throw new Error("Hub revenue database is unavailable.");
  const summary = await getD1CreatorRevenueSummary(database, viewer.id);
  return (
    <V2PanelPage currentPath="/v2/earnings" title="収益">
      <div className="monetization-page">
        <MonetizationDashboard initialSummary={summary} />
        <WalletTipHistory />
      </div>
    </V2PanelPage>
  );
}
