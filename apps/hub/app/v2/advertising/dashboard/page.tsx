import type { Metadata } from "next";

import { AdvertiserDashboard } from "@/components/advertiser-dashboard";
import { V2PanelPage } from "@/components/v2/v2-panel-page";

import "../../v2.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "広告管理 | Hub v2" };

/* 広告主の管理画面。既存の AdvertiserDashboard をそのまま。 */
export default function V2AdvertiserDashboardPage() {
  return (
    <V2PanelPage wide currentPath="/v2/advertising" title="広告管理">
      <AdvertiserDashboard />
    </V2PanelPage>
  );
}
