import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { V2CommunityCreate } from "@/components/v2/v2-community-create";
import { V2PanelPage } from "@/components/v2/v2-panel-page";
import { getCommunityPageData } from "@/lib/server/community-page-data";
import { getHubViewer } from "@/lib/server/hub-viewer";

import "../../v2.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "コミュニティを作る | Hub v2" };

/*
 * コミュニティを作る（2026-09-04、旦那様の「古いUIを出さない」）。
 * 分類の候補は今あるコミュニティから作る（既存と同じ）。
 */
export default async function V2CommunityNewPage() {
  const viewer = await getHubViewer();
  if (!viewer) redirect("/auth?next=/v2/community/new");
  const data = await getCommunityPageData();
  return (
    <V2PanelPage currentPath="/v2/community" title="コミュニティを作る">
      <V2CommunityCreate knownCategories={data.communities.map((community) => community.category)} />
    </V2PanelPage>
  );
}
