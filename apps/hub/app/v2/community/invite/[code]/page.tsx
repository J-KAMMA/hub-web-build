import type { Metadata } from "next";

import CommunityInvitePage from "@/components/community-invite-page";
import { V2PanelPage } from "@/components/v2/v2-panel-page";

import "../../../v2.css";
import "../../../../community-polish.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "コミュニティへの招待 | Hub v2" };

/* 招待の受け取り（規約への同意と参加）。既存のクライアント画面をそのまま v2 の枠に置く。 */
export default function V2CommunityInvitePage() {
  return (
    <V2PanelPage panelOwnsHeading currentPath="/v2/community" title="コミュニティへの招待">
      <CommunityInvitePage />
    </V2PanelPage>
  );
}
