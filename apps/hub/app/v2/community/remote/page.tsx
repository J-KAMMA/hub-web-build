import type { Metadata } from "next";

import { RemoteCommunities } from "@/components/remote-communities";
import { V2PanelPage } from "@/components/v2/v2-panel-page";

import "../../v2.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "他のハブのコミュニティ | Hub v2" };

/* 他のハブのコミュニティに参加して読み書きする。表示は持ち主のハブが配った発言だけ。 */
export default function V2RemoteCommunitiesPage() {
  return (
    <V2PanelPage currentPath="/v2/community" title="他のハブのコミュニティ" wide>
      <RemoteCommunities />
    </V2PanelPage>
  );
}
