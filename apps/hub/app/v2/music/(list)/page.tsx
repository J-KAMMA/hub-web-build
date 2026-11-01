import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";

import { V2Aside } from "@/components/v2/v2-aside";
import { Tabs } from "@/components/v2/ui";
import { V2ColumnHead } from "@/components/v2/v2-columns";
import { V2MoreMenu } from "@/components/v2/v2-more-menu";
import { V2MusicList } from "@/components/v2/v2-music-list";
import { V2MusicShelves, type MusicShelf } from "@/components/v2/v2-music-shelves";
import { rankMusicWorks } from "@/lib/music-ranking";
import { V2MusicShared } from "@/components/v2/v2-music-shared";
import { readSharedMusicWork } from "@/lib/server/music-shared-work";
import { V2MusicRegister } from "@/components/v2/v2-music-register";
import { V2Shell } from "@/components/v2/v2-shell";
import { V2MediaChips } from "@/components/v2/v2-media-chips";
import { V2MediaColumn } from "@/components/v2/v2-media-column";
import { getClientSubscriptions } from "@/lib/server/client-sidebar";
import { loadV2MediaColumn } from "@/lib/server/v2-media-column";
import { MUSIC_EXTERNAL_BROWSE_BELOW, MUSIC_SLOT_SIZE } from "@/lib/music-originals-first";
import { listHubOriginalWorks } from "@/lib/server/music-worker-works";
import { canonicalizeMusicWorks, MUSIC_WORKS, musicGenreLabel, type MusicWork } from "@/lib/music-catalog";
import { getAppShellData } from "@/lib/server/app-shell-data";
import { listD1MusicGenreFacets, listD1MusicTagFacets, listD1MusicWorksPage, type MusicGenreFacet, type MusicTagFacet } from "@/lib/server/d1-music";
import { listD1MusicFavoriteIds } from "@/lib/server/d1-music-favorites";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { getOptionalHubSessionProfile } from "@/lib/server/hub-session";
import { V2LibraryColumn } from "@/components/v2/v2-library-column";
import { loadViewerLibrary } from "@/lib/server/library-column";
import { getHubLocale } from "@/lib/server/locale";
import { isMusicChipGenre, matchesMusicFilters, musicFiltersFromParams, musicGenreChipLabel, type V2MusicSort } from "@/lib/v2-music";
import { v2NavItems } from "@/lib/v2-nav";

import "../../v2.css";
import "../../redesign-media.css";
import { getInstanceOrigin } from "@/lib/instance-origin";
import "@/app/v2/v2-luxe.css";
import "@/app/v2/v2-luxe-pages.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "音楽 | Hub v2",
};

const SORTS: { id: V2MusicSort; ja: string; en: string }[] = [
  { id: "recommended", ja: "おすすめ", en: "For you" },
  { id: "popular", ja: "人気", en: "Popular" },
  { id: "latest", ja: "新着", en: "Latest" },
  { id: "favorites", ja: "お気に入り", en: "Favourites" },
];

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/*
 * v2 の音楽。既存の /music には触れない。
 * 静的カタログ（MUSIC_WORKS）とコミュニティ作品（D1、最初の60件）を合わせる。
 * 既存と同じ。コミュニティ作品の絞り込みはサーバーが行い、静的カタログは
 * lib/v2-music.ts の式で絞る。
 *
 * 内側左列: 並び3つ、ジャンル、タグ（上位24）、既存の画面への入口
 * （ライブラリ・履歴・スタジオは作り直していない）。
 */
export default async function V2MusicPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const locale = await getHubLocale();
  const japanese = locale === "ja";
  const requestedSort = one(params.sort);
  const sort: V2MusicSort = SORTS.some((item) => item.id === requestedSort) ? requestedSort as V2MusicSort : "recommended";
  const filters = musicFiltersFromParams(params);
  const subscriptionsView = one(params.view) === "subscriptions";

  const database = getOptionalHubD1();
  /* Hub のオリジナル（Music Worker の公開済み原盤）。取れなければ空で、外部の曲だけの画面になる。 */
  const originalsPromise = listHubOriginalWorks(getInstanceOrigin(), { query: filters.query });
  const shell = await getAppShellData();
  let communityWorks: MusicWork[] = [];
  let communityTotal = 0;
  let communityOffset = 0;
  let facets: MusicTagFacet[] = [];
  let genreFacets: MusicGenreFacet[] = [];
  let favoriteIds: string[] = [];
  let sharedWork: MusicWork | null = null;
  if (database) {
    const request = new Request(`${getInstanceOrigin()}/v2/music`, { headers: await headers() });
    const viewer = await getOptionalHubSessionProfile(request, database);
    const [page, loadedFacets, loadedFavorites, loadedGenres] = await Promise.all([
      listD1MusicWorksPage(database, 60, 0, filters.genre ? [filters.genre] : [], filters.tags, filters.query).catch(() => ({ works: [], total: 0, nextOffset: 0 })),
      listD1MusicTagFacets(database, 60).catch(() => []),
      viewer ? listD1MusicFavoriteIds(database, viewer.id).catch(() => []) : Promise.resolve([]),
      listD1MusicGenreFacets(database).catch(() => []),
    ]);
    communityWorks = page.works;
    communityTotal = page.total;
    communityOffset = page.nextOffset;
    facets = loadedFacets;
    favoriteIds = loadedFavorites;
    genreFacets = loadedGenres;
    /* ?work= names one song to show first. Unknown or unpublished ids are ignored. */
    const requested = one(params.work);
    if (requested) sharedWork = await readSharedMusicWork(database, requested, getInstanceOrigin());
  }
  const originals = (await originalsPromise).filter((work) => matchesMusicFilters(work, filters))
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  /* 外部の曲（YouTube）。オリジナルは別に持ち、一覧では先に置く。 */
  const external = canonicalizeMusicWorks([...MUSIC_WORKS, ...communityWorks]);
  const works = canonicalizeMusicWorks([...originals, ...external]);
  const viewerId = shell.currentProfile.id || null;
  const column = await loadV2MediaColumn(viewerId, "music");
  /* フォロー中の新着（追っている人が登録した曲。上限つきの読み取り）。 */
  const subscribed: MusicWork[] = subscriptionsView && database && viewerId
    ? await getClientSubscriptions(database, viewerId, "music").then((result) => result.kind === "music" ? result.works : []).catch(() => [])
    : [];
  const items = v2NavItems(japanese, { notifications: shell.unreadIndicatorCount, messages: shell.unreadMessageCount });

  const href = (patch: { sort?: string; genre?: string; tags?: string[]; q?: string }) => {
    const next = new URLSearchParams();
    const merged = { sort: sort === "recommended" ? "" : sort, genre: filters.genre, tags: filters.tags, q: filters.query, ...patch };
    if (merged.sort) next.set("sort", merged.sort);
    if (merged.genre) next.set("genre", merged.genre);
    for (const tag of merged.tags) next.append("tag", tag);
    if (merged.q) next.set("q", merged.q);
    const search = next.toString();
    return `/v2/music${search ? `?${search}` : ""}`;
  };

  /* Navigation facets describe the active catalogue, independently of the current page and filters. */
  const genres = new Map<string, number>();
  for (const facet of genreFacets) genres.set(facet.genre, (genres.get(facet.genre) ?? 0) + facet.count);
  for (const work of MUSIC_WORKS) genres.set(work.genre, (genres.get(work.genre) ?? 0) + 1);
  for (const work of originals) genres.set(work.genre, (genres.get(work.genre) ?? 0) + 1);
  const tagCounts = new Map<string, number>(facets.map((facet) => [facet.tag, facet.count]));
  for (const work of MUSIC_WORKS) for (const tag of work.tags ?? []) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
  const tags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ja")).slice(0, 24);

  /*
   * 絞り込みも並び替えも無い入口は、音楽アプリの棚（旦那様 2026-09-03「音楽は音楽用のuiにして」）。
   * 人気・お気に入り・ジャンルごと。絞り込み時も同じコンパクトな曲の行を使う。
   */
  const browsing = !filters.genre && !filters.tags.length && !filters.query && sort === "recommended" && !subscriptionsView;
  /*
   * Hub のオリジナルを先に（2026-10-14）。枠は MUSIC_SLOT_SIZE 件で、オリジナルで埋まれば外部の曲は出ない。
   * 足りない分だけ外部の曲（YouTube）を別の見出しの下で補う。外部の曲のジャンル棚などの閲覧は、
   * オリジナルが MUSIC_EXTERNAL_BROWSE_BELOW 件に満たないときだけ。
   */
  const externalBrowse = originals.length < MUSIC_EXTERNAL_BROWSE_BELOW;
  const latestOriginals = originals.slice(0, MUSIC_SLOT_SIZE);
  const latestIds = new Set(latestOriginals.map((work) => work.id));
  const moreOriginals = rankMusicWorks(originals).filter((work) => !latestIds.has(work.id)).slice(0, MUSIC_SLOT_SIZE);
  const shelves: MusicShelf[] = browsing ? [
    { id: "hub-latest", title: japanese ? "新しいオリジナル" : "New originals", works: latestOriginals, external },
    ...(moreOriginals.length ? [{ id: "hub-popular", title: japanese ? "よく聴かれているオリジナル" : "Popular originals", works: moreOriginals }] : []),
    { id: "favorites", title: japanese ? "お気に入り" : "Favourites", href: href({ sort: "favorites" }), works: [] },
    ...(externalBrowse ? [{ id: "popular", title: japanese ? "外部の曲で人気（YouTube）" : "Popular external tracks (YouTube)", href: href({ sort: "popular" }), works: [], external }] : []),
  ] : [];

  /* 公開の入口は帯の1つだけ。オリジナルが0曲の入口画面は、同じ位置の案内が主ボタンを持つ。 */
  const showPublish = originals.length > 0 || !browsing;

  const library = await loadViewerLibrary(viewerId, "music", japanese);
  const directory = (
    <>
    <V2MediaColumn
      kind="music"
      japanese={japanese}
      topRows={[
        { key: "home", label: japanese ? "ホーム" : "Home", icon: "home", href: "/v2/music", selected: sort === "recommended" && !filters.genre && !filters.tags.length && !filters.query && !subscriptionsView },
        /* フォロー中の節は動画だけ。追っている人の新着はここから開く。 */
        ...(viewerId ? [{ key: "following", label: japanese ? "フォロー中の新着" : "New from people you follow", icon: "people" as const, href: "/v2/music?view=subscriptions", selected: subscriptionsView }] : []),
        ...(viewerId ? [
          { key: "history", label: japanese ? "履歴" : "History", icon: "clock" as const, href: "/v2/music/history" },
          { key: "library", label: japanese ? "再生リスト" : "Playlists", icon: "list" as const, href: "/v2/music/library" },
          { key: "favorites", label: japanese ? "お気に入り" : "Favourites", icon: "heart" as const, href: href({ sort: "favorites", genre: "", tags: [], q: "" }), selected: sort === "favorites" && !subscriptionsView },
        ] : []),
      ]}
      initial={column.initial}

    />
    <V2LibraryColumn data={library} signedIn={Boolean(viewerId)} japanese={japanese} next="/v2/music" />
    </>
  );
  const topGenres = [...genres.entries()].filter(([genre]) => isMusicChipGenre(genre)).sort((a, b) => b[1] - a[1]).slice(0, 12);
  const noFilter = !filters.genre && !filters.tags.length && !filters.query;
  const chips = [
    { key: "all", label: japanese ? "すべて" : "All", href: href({ genre: "", tags: [], q: "" }), selected: noFilter },
    ...topGenres.map(([genre]) => ({ key: `g:${genre}`, label: musicGenreChipLabel(genre), href: href({ genre, tags: [] }), selected: filters.genre === genre })),
  ];

  return (
    <V2Shell skin="luxe"
      currentPath="/v2/music"
      profile={shell.currentProfile}
      items={items}
      directory={viewerId ? directory : undefined}
      aside={<V2Aside posts={shell.socialPosts} japanese={japanese} signedIn={Boolean(shell.currentProfile.id)} viewerId={shell.currentProfile.id} initialView="music" title={japanese ? "並べて見る" : "Alongside"} />}
      japanese={japanese}
    >
      <V2ColumnHead
        heading
        title={japanese ? "音楽" : "Music"}
        action={<>
          {showPublish ? <Link className="v2-button v2-button--primary v2-music-publish" href="/v2/music/upload"><span className="v2-button__label">{japanese ? "曲を公開" : "Publish"}</span></Link> : null}
          <V2MoreMenu label={japanese ? "その他" : "More"} items={[{ href: "/v2/music/studio", label: japanese ? "スタジオ" : "Studio" }, { href: "/v2/music/library", label: japanese ? "ライブラリ" : "Library" }, { href: "/v2/music/history", label: japanese ? "再生履歴" : "History" }]} />
        </>}
      />

      <Tabs className="v2-l5-tabs v2-music-sorttabs" label={japanese ? "音楽の並び" : "Music order"} value={sort} items={SORTS.map((item) => ({ id: item.id, label: japanese ? item.ja : item.en, href: href({ sort: item.id === "recommended" ? "" : item.id }) }))} />

      <div className="v2-music-toolbar">
      <form className="v2-search__form v2-music-search" role="search" action="/v2/music" method="get">
        {sort !== "recommended" ? <input type="hidden" name="sort" value={sort} /> : null}
        {filters.genre ? <input type="hidden" name="genre" value={filters.genre} /> : null}
        {filters.tags.map((tag) => <input key={tag} type="hidden" name="tag" value={tag} />)}
        <input
          type="search"
          name="q"
          defaultValue={filters.query}
          maxLength={180}
          placeholder={japanese ? "曲名・アーティスト・ジャンルを検索" : "Search titles, artists and genres"}
          aria-label={japanese ? "音楽を検索" : "Search music"}
        />
        <button type="submit" className="v2-search__submit">{japanese ? "検索" : "Search"}</button>
      </form>

      <details className="v2-filter-disclosure v2-music-filter">
        <summary>{japanese ? "絞り込み" : "Filter"}</summary>
        <div className="v2-filter-disclosure__body">
          <div>
            <p className="v2-filter-disclosure__label">{japanese ? "ジャンル" : "Genre"}</p>
            <ul className="v2-facets">
              {[...genres.entries()].sort((a, b) => b[1] - a[1]).slice(0, 16).map(([genre, n]) => (
                <li key={genre}><Link className="v2-facet" href={href({ genre: filters.genre === genre ? "" : genre })} aria-current={filters.genre === genre ? "page" : undefined}>{musicGenreLabel(genre)}<span>{n}</span></Link></li>
              ))}
            </ul>
          </div>
          {tags.length ? (
            <div>
              <p className="v2-filter-disclosure__label">{japanese ? "タグ" : "Tags"}</p>
              <ul className="v2-facets">
                {tags.map(([tag, n]) => {
                  const active = filters.tags.includes(tag);
                  return <li key={tag}><Link className="v2-facet" href={href({ tags: active ? filters.tags.filter((item) => item !== tag) : [...filters.tags, tag].slice(0, 8) })} aria-current={active ? "page" : undefined}>#{tag}<span>{n}</span></Link></li>;
                })}
              </ul>
            </div>
          ) : null}
        </div>
      </details>
      </div>

      <V2MediaChips label={japanese ? "ジャンル" : "Genres"} chips={chips} japanese={japanese} />

      {filters.genre || filters.tags.length || filters.query ? (
        <p className="v2-note">
          {filters.genre ? <span className="v2-badge">{musicGenreLabel(filters.genre)}</span> : null}
          {filters.tags.map((tag) => <span key={tag} className="v2-badge">#{tag}</span>)}
          {filters.query ? <span className="v2-badge">{filters.query}</span> : null}
          {" "}
          <Link className="v2-card__link" href={href({ genre: "", tags: [], q: "" })}>{japanese ? "絞り込みを解除" : "Clear"}</Link>
        </p>
      ) : null}

      {sharedWork ? <V2MusicShared key={sharedWork.id} work={sharedWork} initialFavoriteIds={favoriteIds} authenticated={Boolean(shell.currentProfile.id)} locale={locale} /> : null}

      {subscriptionsView ? (
        viewerId ? (
          <V2MusicList
            key={`subscriptions:${subscribed.length}`}
            works={subscribed}
            communityOffset={0}
            communityTotal={0}
            filters={{ genre: "", tags: [], query: "" }}
            sort="latest"
            initialFavoriteIds={favoriteIds}
            authenticated
            locale={locale}
          />
        ) : <p className="v2-note v2-reply-auth"><Link href="/v2/auth">{japanese ? "ログイン" : "Sign in"}</Link>{japanese ? "すると、追っている人の新しい曲が出ます。" : " to see new tracks from people you follow."}</p>
      ) : browsing ? (
        <V2MusicShelves shelves={shelves} initialFavoriteIds={favoriteIds} authenticated={Boolean(shell.currentProfile.id)} locale={locale} communityOffset={communityOffset} communityTotal={communityTotal} expandGenres externalBrowse={externalBrowse} />
      ) : (
      <V2MusicList
        key={`${sort}:${JSON.stringify(filters)}`}
        works={works}
        communityOffset={communityOffset}
        communityTotal={communityTotal}
        filters={filters}
        sort={sort}
        initialFavoriteIds={favoriteIds}
        authenticated={Boolean(shell.currentProfile.id)}
        locale={locale}
      />
      )}

      {shell.currentProfile.id ? <div className="v2-music-register"><V2MusicRegister locale={locale} /></div> : null}
      {sort === "recommended" && !filters.query ? <details className="v2-music-how"><summary>{japanese ? "おすすめの仕組み" : "How picks work"}</summary><p>
        {japanese ? "Hub Musicを先に表示し、足りない分をYouTube Musicで補います。この端末の再生履歴・お気に入り・ジャンルを優先し、同じ作者に偏らないように表示しています。履歴がない場合も公開カタログから選びます。" : "Hub Music comes first; YouTube Music only fills the remaining space. Picked from this device's history, favourites and genres without repeating one artist. With no history, picks come from the public catalogue."}
      </p></details> : null}
    </V2Shell>
  );
}
