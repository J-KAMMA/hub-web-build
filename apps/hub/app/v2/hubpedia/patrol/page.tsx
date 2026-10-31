import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { HubpediaPatrolConsole, type PatrolItem, type PatrolRecent } from "@/components/v2/hubpedia-patrol-console";
import { V2DirectoryRail } from "@/components/v2/v2-directory-rail";
import { V2PanelPage } from "@/components/v2/v2-panel-page";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { getHubViewer } from "@/lib/server/hub-viewer";
import { getWikiRole } from "@/lib/server/hubpedia-wiki-policy";
import { listPendingPage, listRecentChanges } from "@/lib/server/hubpedia-wiki-patrol";

import "../../v2.css";
import "../hubpedia-wiki.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "見回り | Hubpedia | Hub v2", robots: { index: false, follow: false } };

/* 見回り役と運営だけの画面。それ以外の人には、ページが無いものとして返す。 */
export default async function V2HubpediaPatrolPage() {
  const viewer = await getHubViewer();
  const database = getOptionalHubD1();
  if (!viewer || !database) notFound();
  const role = await getWikiRole(database, viewer.id);
  if (role === "editor") notFound();
  const [queue, recent] = await Promise.all([
    listPendingPage(database, viewer, { limit: 30 }).catch(() => null),
    listRecentChanges(database, { limit: 15 }).catch(() => null),
  ]);
  return (
    <V2PanelPage directoryRail={<V2DirectoryRail back={{ href: "/v2/hubpedia/recent-changes", label: "最近の変更へ" }} />} currentPath="/v2/hubpedia" title="見回り" note={role === "operator" ? "運営" : "見回り役"}>
      {queue === null ? (
        <div role="status"><p className="v2-error">審査待ちの提案を取得できませんでした。</p><a href="/v2/hubpedia/patrol">再読み込み</a></div>
      ) : (
        <HubpediaPatrolConsole
          role={role}
          initialItems={queue.items as unknown as PatrolItem[]}
          nextCursor={queue.nextCursor}
          recent={(recent?.items ?? []) as unknown as PatrolRecent[]}
        />
      )}
    </V2PanelPage>
  );
}
