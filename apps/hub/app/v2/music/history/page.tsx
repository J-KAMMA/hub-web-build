import type { Metadata } from "next";

import { MusicHistory } from "@/components/music-history";
import { MusicSectionNav } from "@/components/music-section-nav";
import { V2PanelPage } from "@/components/v2/v2-panel-page";
import { listD1MusicWorks } from "@/lib/server/d1-music";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";

import "../../v2.css";
import "../../v2-media.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "履歴 | 音楽 | Hub v2" };

export default async function V2MusicHistoryPage() {
  const database = getOptionalHubD1();
  const works = database ? await listD1MusicWorks(database).catch(() => []) : [];
  return (
    <V2PanelPage currentPath="/v2/music/history" title="履歴">
      <MusicSectionNav current="history" />
      <MusicHistory initialWorks={works} />
    </V2PanelPage>
  );
}
