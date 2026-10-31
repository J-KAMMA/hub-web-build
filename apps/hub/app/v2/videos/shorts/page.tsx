import type { Metadata } from "next";

import { V2Aside } from "@/components/v2/v2-aside";
import { V2ColumnHead } from "@/components/v2/v2-columns";
import { V2DirectoryRail } from "@/components/v2/v2-directory-rail";
import { V2Shell } from "@/components/v2/v2-shell";
import { V2ShortsFeed } from "@/components/v2/v2-shorts-feed";
import { getAppShellData } from "@/lib/server/app-shell-data";
import { listD1ExternalVideosPage } from "@/lib/server/d1-videos";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { getHubLocale } from "@/lib/server/locale";
import { v2NavItems } from "@/lib/v2-nav";
import { isShort } from "@/lib/v2-video";

import "../../v2.css";
import "../../v2-media.css";
import "@/app/v2/v2-luxe.css";
import "@/app/v2/v2-luxe-pages.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "ショート | 動画 | Hub v2" };

/* 縦のショート。候補は新着50本のうちショートで、再生できるもの（閲覧条件つきは除く）。 */
export default async function V2ShortsPage() {
  const locale = await getHubLocale();
  const japanese = locale === "ja";
  const database = getOptionalHubD1();
  const { currentProfile, socialPosts, unreadIndicatorCount, unreadMessageCount } = await getAppShellData();
  const viewerId = currentProfile.id ?? "";
  const catalog = database
    ? await listD1ExternalVideosPage(database, 50, 0, { order: "recent", viewerProfileId: viewerId || null }).catch(() => ({ videos: [] }))
    : { videos: [] };
  const videos = catalog.videos.filter((video) => isShort(video) && !video.accessGate && video.availabilityStatus !== "unavailable");
  const items = v2NavItems(japanese, { notifications: unreadIndicatorCount, messages: unreadMessageCount });

  return (
    <V2Shell skin="luxe"
      directoryRail={<V2DirectoryRail back={{ href: "/v2/videos", label: japanese ? "動画一覧へ" : "All videos" }} japanese={japanese} />}
      currentPath="/v2/videos"
      profile={currentProfile}
      items={items}
      aside={<V2Aside posts={socialPosts} japanese={japanese} signedIn={Boolean(viewerId)} viewerId={viewerId} title={japanese ? "並べて見る" : "Alongside"} />}
      japanese={japanese}
    >
      <V2ColumnHead heading title={japanese ? "ショート" : "Shorts"} />
      <V2ShortsFeed videos={videos} locale={locale} authenticated={Boolean(viewerId)} />
    </V2Shell>
  );
}
