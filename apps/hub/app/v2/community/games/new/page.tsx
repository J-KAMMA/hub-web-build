import type { Metadata } from "next";

import { GameSubmissionForm } from "@/components/game-submission-form";
import { V2PanelPage } from "@/components/v2/v2-panel-page";
import { getCommunityPageData } from "@/lib/server/community-page-data";
import { getHubViewer } from "@/lib/server/hub-viewer";

import "../../../v2.css";
import "../../../v2-media.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "ゲームの攻略を登録 | コミュニティ | Hub v2", robots: { index: false, follow: false } };

/*
 * 攻略・wikiを作るゲームの登録（2026-10-29、所有者の決定でゲームの店から移した）。
 * ゲームの店（/v2/games）は購入とライブラリだけ。作品を攻略のために登録するこの画面はコミュニティ側に置く。
 * フォームと送り先 API は従来のまま。戻り先もこの画面にする——ログインの往復で面が変わらないように。
 */
export default async function V2CommunityNewGamePage({ searchParams }: { searchParams: Promise<{ community?: string }> }) {
  const query = await searchParams;
  const [data, viewer] = await Promise.all([getCommunityPageData(), getHubViewer()]);
  const managed = data.communities
    .filter((community) => community.viewerRole === "owner" || community.viewerRole === "moderator")
    .map((community) => ({ id: community.id, name: community.name }));
  const initialCommunityId = managed.some((community) => community.id === query.community) ? query.community : "";
  const requestedCommunity = query.community?.slice(0, 100);
  const returnPath = requestedCommunity
    ? `/v2/community/games/new?community=${encodeURIComponent(requestedCommunity)}`
    : "/v2/community/games/new";
  return (
    <V2PanelPage wide currentPath="/v2/community" title="ゲームの攻略を登録">
      <div className="game-submission-page">
        <GameSubmissionForm
          authenticated={Boolean(viewer)}
          communities={managed}
          initialCommunityId={initialCommunityId}
          loginHref={`/auth?next=${encodeURIComponent(returnPath)}`}
        />
      </div>
    </V2PanelPage>
  );
}
