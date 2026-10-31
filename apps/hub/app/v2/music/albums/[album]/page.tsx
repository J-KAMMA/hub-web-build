import type { Metadata } from "next";

import { MusicCollectionView } from "@/components/music-collection-view";
import { V2PanelPage } from "@/components/v2/v2-panel-page";
import { canonicalizeMusicWorks, musicAlbumLabel } from "@/lib/music-catalog";
import { listD1MusicWorks } from "@/lib/server/d1-music";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";

import "../../../../music.css";
import "../../../v2.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "アルバム | Hub v2" };

/*
 * アルバムのまとまり（2026-09-04、旦那様の「古いUIを出さない」）。
 *
 * アルバムはプレイリストで足りるという旦那様の判断があるので、機能は増やさない。
 * ただしライブラリの「アルバム」の札からここへ来るので、v2 に無いままだと
 * 押すたびに古いUIへ出る。既存の MusicCollectionView をそのまま置く。
 */
export default async function V2MusicAlbumPage({
  params,
  searchParams,
}: {
  params: Promise<{ album: string }>;
  searchParams: Promise<{ artist?: string }>;
}) {
  const album = decodeURIComponent((await params).album).normalize("NFKC").trim();
  const artist = (await searchParams).artist?.normalize("NFKC").trim() ?? "";
  const database = getOptionalHubD1();
  const communityWorks = database ? await listD1MusicWorks(database) : [];
  const works = canonicalizeMusicWorks(communityWorks).filter((work) =>
    musicAlbumLabel(work).toLocaleLowerCase("ja-JP") === album.toLocaleLowerCase("ja-JP")
    && (!artist || work.artist.toLocaleLowerCase("ja-JP") === artist.toLocaleLowerCase("ja-JP")));
  return (
    <V2PanelPage panelOwnsHeading currentPath="/v2/music" title={album}>
      <MusicCollectionView
        title={album}
        description={`${artist ? `${artist} · ` : ""}${works.length > 1 ? "アルバム" : "シングル"}`}
        works={works}
        collectionType="album"
        collectionId={`${artist}\u0000${album}`}
      />
    </V2PanelPage>
  );
}
