import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";

import { PersonalNodeDashboard } from "@/components/personal-node-dashboard";
import { V2PanelPage } from "@/components/v2/v2-panel-page";
import { getHubViewer } from "@/lib/server/hub-viewer";

import "../v2.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Personal Node | Hub v2" };

/* 自分のデータとAI。既存の PersonalNodeDashboard（鍵と端末を扱う）をそのまま。 */
export default async function V2NodePage() {
  const viewer = await getHubViewer();
  if (!viewer) redirect("/v2/auth?next=/v2/node");
  return (
    <V2PanelPage panelOwnsHeading currentPath="/v2/node" title="Personal Node">
      <p><Link href="/v2/settings#hub-connections">接続するHubを管理</Link></p>
      <PersonalNodeDashboard />
      <details><summary>端末間でファイルを送る</summary><p><Link href="/p2p">ファイル転送を開く</Link></p></details>
    </V2PanelPage>
  );
}
