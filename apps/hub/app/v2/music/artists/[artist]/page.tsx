import type { Metadata } from "next";

import { MusicCollectionView } from "@/components/music-collection-view";
import { V2PanelPage } from "@/components/v2/v2-panel-page";
import { canonicalizeMusicWorks } from "@/lib/music-catalog";
import { listD1MusicWorks } from "@/lib/server/d1-music";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";

import "../../../v2.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "アーティスト | 音楽 | Hub v2" };

/* アーティストの曲一覧。既存の MusicCollectionView をそのまま。 */
export default async function V2MusicArtistPage({ params }: { params: Promise<{ artist: string }> }) {
  const artist = decodeURIComponent((await params).artist).normalize("NFKC").trim();
  const database = getOptionalHubD1();
  const communityWorks = database ? await listD1MusicWorks(database).catch(() => []) : [];
  const works = canonicalizeMusicWorks(communityWorks).filter((work) => work.artist.toLocaleLowerCase("ja-JP") === artist.toLocaleLowerCase("ja-JP"));
  return (
    <V2PanelPage panelOwnsHeading currentPath="/v2/music" title={artist}>
      <MusicCollectionView title={artist} description={`${artist}の公開曲、シングル、関連作品をまとめています。`} works={works} collectionType="artist" collectionId={artist} />
    </V2PanelPage>
  );
}
