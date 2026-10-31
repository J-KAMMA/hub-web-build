import type { Metadata } from "next";

import CommunityReviewPage from "@/components/community-review-page";
import { V2PanelPage } from "@/components/v2/v2-panel-page";

import "../../v2.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "コミュニティの審査 | Hub v2" };

/* 公開申請の審査（運営権限）。既存のクライアント画面をそのまま v2 の枠に置く。 */
export default function V2CommunityReviewPage() {
  return (
    <V2PanelPage panelOwnsHeading currentPath="/v2/community" title="コミュニティの審査">
      <CommunityReviewPage />
    </V2PanelPage>
  );
}
