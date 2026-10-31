import type { Metadata } from "next";
import { headers } from "next/headers";

import { V2Aside } from "@/components/v2/v2-aside";
import { V2ColumnHead } from "@/components/v2/v2-columns";
import { V2Lists, type V2ListsTab } from "@/components/v2/v2-lists";
import { V2Shell } from "@/components/v2/v2-shell";
import { getAppShellData } from "@/lib/server/app-shell-data";
import { listD1MusicPlaylists } from "@/lib/server/d1-music-playlists";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { getOptionalHubSessionProfile } from "@/lib/server/hub-session";
import { getListsPageData } from "@/lib/server/lists-page-data";
import { getHubLocale } from "@/lib/server/locale";
import { v2NavItems } from "@/lib/v2-nav";

import "../v2.css";
import "../redesign-sns.css";
import { getInstanceOrigin } from "@/lib/instance-origin";
import "../v2-luxe.css";
import "../v2-luxe-social.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "リスト | Hub v2",
};

/* 既存の /lists と同じ材料（プレイリスト・コミュニティのリスト）を同じ順で集める。 */
export default async function V2ListsPage({ searchParams }: { searchParams: Promise<{ tab?: string | string[]; list?: string | string[] }> }) {
  const [locale, params, shell, listsData] = await Promise.all([getHubLocale(), searchParams, getAppShellData(), getListsPageData()]);
  const japanese = locale === "ja";
  const rawTab = Array.isArray(params.tab) ? params.tab[0] : params.tab;
  const rawList = Array.isArray(params.list) ? params.list[0] : params.list;
  const tab: V2ListsTab = rawTab === "community" ? rawTab : "playlists";
  const focusListId = typeof rawList === "string" && rawList.trim() ? rawList.trim().slice(0, 200) : null;
  const database = getOptionalHubD1();
  let playlists: Awaited<ReturnType<typeof listD1MusicPlaylists>> = [];
  let authenticated = false;
  if (database) {
    try {
      const request = new Request(`${getInstanceOrigin()}/v2/lists`, { headers: await headers() });
      const viewer = await getOptionalHubSessionProfile(request, database);
      authenticated = Boolean(viewer);
      playlists = viewer ? await listD1MusicPlaylists(database, viewer.id) : [];
    } catch {
      /* プレイリストが取れなくても、コミュニティのリストは出す。 */
    }
  }
  const items = v2NavItems(japanese, { notifications: shell.unreadIndicatorCount, messages: shell.unreadMessageCount });

  const directory = (
    <ul className="v2-nav__list">
      <li><a className="v2-nav__item" href="/v2/lists" aria-current={tab === "playlists" ? "page" : undefined}><span className="v2-nav__label">{japanese ? "プレイリスト" : "Playlists"}</span><span className="v2-nav__count v2-nav__count--quiet">{playlists.length}</span></a></li>
      <li><a className="v2-nav__item" href="/v2/lists?tab=community" aria-current={tab === "community" ? "page" : undefined}><span className="v2-nav__label">{japanese ? "コミュニティのリスト" : "Community lists"}</span><span className="v2-nav__count v2-nav__count--quiet">{listsData.lists.length}</span></a></li>
      <li><a className="v2-nav__item" href="/v2/bookmarks"><span className="v2-nav__label">{japanese ? "ブックマーク" : "Bookmarks"}</span><span className="v2-nav__count v2-nav__count--quiet">{listsData.bookmarkCount}</span></a></li>
    </ul>
  );

  return (
    <V2Shell skin="luxe"
      currentPath="/v2/lists"
      profile={shell.currentProfile}
      items={items}
      directoryTitle={japanese ? "リスト" : "Lists"}
      directory={directory}
      aside={<V2Aside posts={shell.socialPosts} japanese={japanese} signedIn={Boolean(shell.currentProfile.id)} viewerId={shell.currentProfile.id} title={japanese ? "並べて見る" : "Alongside"} />}
      japanese={japanese}
    >
      <V2ColumnHead heading title={japanese ? "リスト" : "Lists"} />
      <V2Lists
        tab={tab}
        playlists={playlists.map((playlist) => ({ id: playlist.id, title: playlist.title, description: playlist.description, workIds: playlist.workIds }))}
        communityLists={listsData.lists}
        focusListId={focusListId}
        authenticated={authenticated}
        japanese={japanese}
      />
    </V2Shell>
  );
}
