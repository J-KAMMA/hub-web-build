import type { Metadata } from "next";

import { V2Aside } from "@/components/v2/v2-aside";
import { V2ColumnHead } from "@/components/v2/v2-columns";
import { V2Search, type SearchGroup, type SearchOrder, type SearchPayload } from "@/components/v2/v2-search";
import { SEARCH_TABS } from "@/lib/search-tabs";
import { Chip, ChipRow } from "@/components/v2/ui/chip";
import { V2Shell } from "@/components/v2/v2-shell";
import { EMPTY_HUB_SEARCH_FILTERS, hasHubSearchFilters, parseHubSearchFilters } from "@/lib/search-filters";
import { getAppShellData } from "@/lib/server/app-shell-data";
import { getHubViewer } from "@/lib/server/hub-viewer";
import { getD1SearchRouteData } from "@/lib/server/d1-search-route-data";
import { getD1SearchExtras } from "@/lib/server/d1-search-extras";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { getHubLocale } from "@/lib/server/locale";
import { getD1SearchCatalogRevision } from "@/lib/server/search-catalog-revision";
import { getHubSearchCatalogVersion } from "@/lib/server/search-cursor";
import { prepareHubSearchInitialPage } from "@/lib/server/search-initial-page";
import { v2NavItems } from "@/lib/v2-nav";
import { normalizeSearchValue } from "@/lib/search-relevance";

import "../v2.css";
import "../v2-luxe.css";
import "../v2-luxe-social.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "検索 | Hub v2",
};

const GROUPS: readonly SearchGroup[] = SEARCH_TABS;

/*
 * v2 の検索。初回の結果はサーバーで取って描く。URL を開いた瞬間に結果が
 * 出ていないと、共有やブックマークから来た人には空の画面に見える。
 * 以降の検索はクライアントが /api/search を叩く。
 */
export default async function V2SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const locale = await getHubLocale();
  const japanese = locale === "ja";
  const params = await searchParams;
  const parsedFilters = parseHubSearchFilters(params);
  const filters = parsedFilters.ok ? parsedFilters.filters : EMPTY_HUB_SEARCH_FILTERS;
  const rawQuery = Array.isArray(params.q) ? params.q[0] : params.q;
  const rawGroup = Array.isArray(params.group) ? params.group[0] : params.group;
  const rawOrder = Array.isArray(params.order) ? params.order[0] : params.order;
  /*
   * 画面と履歴には打った語をそのまま渡す。正規化（NFKC・小文字）は探すときだけ。
   * 正規化した語を渡すと、URLは Kamma のまま履歴だけ kamma になり、
   * 札を押した瞬間にURLまで kamma へ書き換わる。
   */
  const query = (rawQuery ?? "").trim().slice(0, 100);
  const normalized = normalizeSearchValue(query).slice(0, 100);
  const group: SearchGroup = GROUPS.includes(rawGroup as SearchGroup) ? rawGroup as SearchGroup : "all";
  const order: SearchOrder = rawOrder === "kind" ? "kind" : "recommended";

  /*
   * The shell (viewer, unread counts, aside timeline) and the search itself only share the
   * viewer id, which getHubViewer() memoises per request. They used to run one after the
   * other.
   */
  const shellPromise = getAppShellData();
  const initialResultsPromise = (async (): Promise<SearchPayload | null> => {
  const viewerId = (await getHubViewer())?.id ?? "";
  let initialResults: SearchPayload | null = null;
  if ((normalized || hasHubSearchFilters(filters)) && parsedFilters.ok) {
    const database = getOptionalHubD1();
    if (database) {
      try {
        const data = hasHubSearchFilters(filters)
          ? await getD1SearchRouteData(normalized, viewerId || null, filters)
          : await getD1SearchRouteData(normalized, viewerId || null);
        const candidateVersion = getHubSearchCatalogVersion(data.coreEntities, null, data.counts);
        const durableRevision = candidateVersion
          ? await getD1SearchCatalogRevision(database)
          : null;
        const initialPage = prepareHubSearchInitialPage(data, {
          viewerProfileId: viewerId || null,
          filters,
          order,
          durableRevision,
        });
        /* 画像も渡す。API は最初から返していて、v2 だけ捨てていた（2026-09-04）。 */
        /* 記事・音楽・タグと、タグだけで当たったもの。絞り込み中は付けない。 */
        const extras = normalized && !hasHubSearchFilters(filters)
          ? await getD1SearchExtras(database, {
              query: normalized,
              viewerId: viewerId || null,
              profileIds: (data.profiles ?? []).map((profile) => profile.id),
              postIds: (data.posts ?? []).map((post) => post.id),
            }).catch(() => undefined)
          : undefined;
        initialResults = {
          ...(extras ? { extras } : {}),
          query: initialPage.query,
          coreEntities: initialPage.coreEntities,
          counts: initialPage.counts,
          images: initialPage.images,
          /* 結果の札に出す補足。API の応答と同じ形で渡す。 */
          profiles: data.profiles,
          hubpedia: data.hubpedia,
          /* クライアントの parseRawThreads / parseVideos と同じ形にそろえる。 */
          threads: (data.threads ?? []).map((thread) => ({ id: thread.id, href: "", title: thread.title, boardKey: thread.boardKey, postCount: thread.postCount })),
          videos: (data.videos ?? []).map((video) => ({ id: video.id, title: video.title, channel: video.channel, category: video.category, thumbnailUrl: video.gated ? null : video.thumbnailUrl ?? null, gated: video.gated })),
          ...(initialPage.nextCursor ? { nextCursor: initialPage.nextCursor, hasMore: true } : {}),
        };
      } catch {
        /* サーバーで取れなければクライアントに任せる。画面は落とさない。 */
        initialResults = null;
      }
    }
  }
  return initialResults;
  })();
  const [{ currentProfile, socialPosts, unreadIndicatorCount, unreadMessageCount }, initialResults] = await Promise.all([shellPromise, initialResultsPromise]);

  const items = v2NavItems(japanese, { notifications: unreadIndicatorCount, messages: unreadMessageCount });

  /*
   * 内側左列には、よく探すものへの近道を置く。既存の「気になるものから探す」
   * の定型検索と同じ役目。
   */
  const starters: [string, string][] = japanese
    ? [["いまの話題", "話題"], ["人物", "人"], ["画像・作品", "画像"], ["質問・相談", "質問"]]
    : [["Trending", "trending"], ["People", "people"], ["Images", "images"], ["Questions", "question"]];

  /* 検索の札にない入口だけ。記事・動画・音楽・Hubpedia・スレッドは結果の札が受け持つ（2026-10-28）。 */
  const kinds: [string, string][] = japanese
    ? [["本", "/v2/books"], ["マーケット", "/v2/market"], ["サービス一覧", "/v2/services"]]
    : [["Books", "/v2/books"], ["Market", "/v2/market"], ["All services", "/v2/services"]];

  /* 近道。検索語が無いときだけ、結果の代わりに本文の頭へ置く（内側左列は使わない）。 */
  const shortcuts = !query && !hasHubSearchFilters(filters) ? (
    <div className="v2-search__starters">
      <ChipRow label={japanese ? "よく探すもの" : "Common searches"}>
        {starters.map(([label, q]) => <Chip key={q} href={`/v2/search?q=${encodeURIComponent(q)}`}>{label}</Chip>)}
      </ChipRow>
      <ChipRow label={japanese ? "ほかの入口" : "More places"}>
        {kinds.map(([label, href]) => <Chip key={href} href={href}>{label}</Chip>)}
      </ChipRow>
    </div>
  ) : null;

  return (
    <V2Shell skin="luxe"
      currentPath="/v2/search"
      profile={currentProfile}
      items={items}
      aside={
        <V2Aside
          posts={socialPosts}
          japanese={japanese}
          signedIn={Boolean(currentProfile.id)} viewerId={currentProfile.id}
          title={japanese ? "並べて見る" : "Alongside"}
        />
      }
      japanese={japanese}
    >
      <V2ColumnHead heading title={japanese ? "検索" : "Search"} />
      <V2Search
        initialQuery={query}
        initialGroup={group}
        initialOrder={order}
        initialFilters={filters}
        initialFilterError={!parsedFilters.ok}
        initialResults={initialResults}
        japanese={japanese}
        viewerId={currentProfile.id}
      />
      {shortcuts}
    </V2Shell>
  );
}
