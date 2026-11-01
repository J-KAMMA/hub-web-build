import type { Metadata } from "next";
import Link from "next/link";

import { V2Aside } from "@/components/v2/v2-aside";
import { V2ColumnHead } from "@/components/v2/v2-columns";
import { V2Shell } from "@/components/v2/v2-shell";
import { V2VideoList, type V2VideoMode } from "@/components/v2/v2-video-list";
import { V2RecommendedVideos } from "@/components/v2/v2-recommended-videos";
import { V2MediaChips } from "@/components/v2/v2-media-chips";
import { V2MediaColumn } from "@/components/v2/v2-media-column";
import { V2ShortShelf } from "@/components/v2/v2-short-shelf";
import { V2RemoteHubVideos } from "@/components/v2/v2-remote-hub-videos";
import { listRemoteHubVideos } from "@/lib/server/remote-hub-videos";
import { getClientSubscriptions } from "@/lib/server/client-sidebar";
import { loadV2MediaColumn } from "@/lib/server/v2-media-column";
import { getAppShellData } from "@/lib/server/app-shell-data";
import { listD1ExternalVideosPage } from "@/lib/server/d1-videos";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { V2LibraryColumn } from "@/components/v2/v2-library-column";
import { loadViewerLibrary } from "@/lib/server/library-column";
import { getHubLocale } from "@/lib/server/locale";
import { isOptionalServiceEnabled } from "@/lib/optional-services";
import { v2NavItems } from "@/lib/v2-nav";
import { V2_PROVIDER_LABELS, videoFiltersFromParams } from "@/lib/v2-video";

import "../../v2.css";
import "../../redesign-media.css";
import "@/app/v2/v2-luxe.css";
import "@/app/v2/v2-luxe-pages.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "動画 | Hub v2",
};

type PageMode = V2VideoMode | "subscriptions";
const MODES: { id: PageMode; ja: string; en: string }[] = [
  { id: "subscriptions", ja: "フォロー中", en: "Following" },
  { id: "recommended", ja: "おすすめ", en: "For you" },
  { id: "recent", ja: "新着", en: "Latest" },
  { id: "popular", ja: "人気", en: "Popular" },
  { id: "rising", ja: "急上昇", en: "Rising" },
  { id: "shorts", ja: "ショート", en: "Shorts" },
  { id: "saved", ja: "保存", en: "Saved" },
];

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/*
 * v2 の動画一覧。既存の /videos には触れない。
 * 最初の頁はサーバーで50件取って絞る（既存はクライアントで絞っていたので、
 * 最初の描画は絞れていなかった）。人気・急上昇・保存はクライアントが取る。
 *
 * 内側左列: 5つの表示、配信元、分類、絞り込み。どれも押すとURLが変わる。
 */
export default async function V2VideosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const locale = await getHubLocale();
  const japanese = locale === "ja";
  const requestedMode = one(params.mode);
  const mode: PageMode = MODES.some((item) => item.id === requestedMode) ? requestedMode as PageMode : "recommended";
  const filters = videoFiltersFromParams(params);

  const database = getOptionalHubD1();
  const { currentProfile, socialPosts, unreadIndicatorCount, unreadMessageCount } = await getAppShellData();
  const catalog = database
    ? await listD1ExternalVideosPage(database, 50, 0, { viewerProfileId: currentProfile.id || null })
    : { videos: [], total: 0, categories: [] };

  /* 他のハブの動画（相手のページへのリンクだけ。上限12件、失敗しても一覧は出す）。 */
  const remoteVideos = database && mode === "recommended" && !filters.category && !filters.query
    ? await listRemoteHubVideos(database, 12).catch(() => [])
    : [];

  const column = await loadV2MediaColumn(currentProfile.id, "videos");
  /* フォロー中の新着（本人のフォローだけ。上限つきの読み取り）。 */
  const subscribed = mode === "subscriptions" && database && currentProfile.id
    ? await getClientSubscriptions(database, currentProfile.id, "videos").then((result) => result.kind === "videos" ? result.videos : []).catch(() => [])
    : [];

  const items = v2NavItems(japanese, { notifications: unreadIndicatorCount, messages: unreadMessageCount });

  const href = (patch: Record<string, string | undefined>) => {
    const merged = {
      mode: mode === "recommended" ? "" : mode,
      provider: filters.provider,
      category: filters.category,
      length: filters.length,
      date: filters.date,
      lang: filters.language,
      q: filters.query,
      ...patch,
    };
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(merged)) if (value) next.set(key, value);
    const search = next.toString();
    return `/v2/videos${search ? `?${search}` : ""}`;
  };

  /* 配信元と分類の数は、読み込んだ50件の中で数える。全件の集計は呼ばない。 */
  const count = (key: "provider" | "category") => {
    const map = new Map<string, number>();
    for (const video of catalog.videos) map.set(video[key], (map.get(video[key]) ?? 0) + 1);
    return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ja"));
  };

  const categories = count("category").slice(0, 12);
  const home = mode === "recommended" && !filters.category && !filters.query;
  const topRows = [
    { key: "home", label: japanese ? "ホーム" : "Home", icon: "home" as const, href: "/v2/videos", selected: home },
    { key: "shorts", label: japanese ? "ショート" : "Shorts", icon: "shorts" as const, href: "/v2/videos/shorts", selected: mode === "shorts" },
    /* 自分のライブラリは上の段の続き（見出しも区切りも無い）。 */
    ...(currentProfile.id ? [
      { key: "later", label: japanese ? "あとで見る" : "Watch later", icon: "clock" as const, href: href({ mode: "saved", category: "", q: "" }), selected: mode === "saved" },
      { key: "mine", label: japanese ? "自分の動画" : "Your videos", icon: "video" as const, href: "/v2/studio/videos" },
    ] : []),
  ];
  const library = await loadViewerLibrary(currentProfile.id, "videos", japanese);
  const directory = (
    <>
    <V2MediaColumn
      kind="videos"
      japanese={japanese}
      topRows={topRows}
      subscriptionsHref={href({ mode: "subscriptions", category: "", q: "" })}
      subscriptionsSelected={mode === "subscriptions"}
      initial={column.initial}

    />
    <V2LibraryColumn data={library} signedIn={Boolean(currentProfile.id)} japanese={japanese} next="/v2/videos" />
    </>
  );
  const chips = [
    { key: "all", label: japanese ? "すべて" : "All", href: href({ category: "", q: "" }), selected: !filters.category && !filters.query },
    ...categories.map(([category]) => ({ key: `c:${category}`, label: category, href: href({ category, q: "" }), selected: filters.category === category })),
    ...column.followedTags.map((tag) => ({ key: `t:${tag}`, label: `#${tag}`, href: href({ category: "", q: tag }), selected: filters.query === tag })),
  ];

  const active = [
    filters.provider ? V2_PROVIDER_LABELS[filters.provider as keyof typeof V2_PROVIDER_LABELS] : "",
    filters.category,
    filters.length ? { under4: "4分未満", "4to20": "4〜20分", over20: "20分以上" }[filters.length] : "",
    filters.date ? { week: "1週間", month: "1か月", year: "1年" }[filters.date] : "",
    filters.language ? { ja: "日本語", latin: "英語など" }[filters.language] : "",
    filters.query,
  ].filter(Boolean);

  return (
    <V2Shell skin="luxe"
      currentPath="/v2/videos"
      profile={currentProfile}
      items={items}
      directory={directory}
      aside={<V2Aside posts={socialPosts} japanese={japanese} signedIn={Boolean(currentProfile.id)} viewerId={currentProfile.id} title={japanese ? "並べて見る" : "Alongside"} />}
      japanese={japanese}
    >
      <V2ColumnHead
        heading
        title={japanese ? "動画" : "Video"}
        action={<>
          <span className="v2-heading__note">{japanese ? MODES.find((item) => item.id === mode)?.ja : MODES.find((item) => item.id === mode)?.en}{mode === "recent" || mode === "shorts" ? (japanese ? ` · ${catalog.total}本` : ` · ${catalog.total} videos`) : null}</span>
          {japanese && isOptionalServiceEnabled("video") ? <Link className="ui-button ui-button--primary" href="/v2/studio/videos"><span className="ui-button__label">動画を投稿</span></Link> : null}
        </>}
      />

      <V2MediaChips label={japanese ? "動画の分類" : "Video categories"} chips={chips} japanese={japanese} />

      <form className="v2-search__form v2-vsearch" role="search" action="/v2/videos" method="get">
        {mode !== "recommended" ? <input type="hidden" name="mode" value={mode} /> : null}
        {filters.provider ? <input type="hidden" name="provider" value={filters.provider} /> : null}
        {filters.category ? <input type="hidden" name="category" value={filters.category} /> : null}
        <input
          type="search"
          name="q"
          defaultValue={filters.query}
          maxLength={100}
          placeholder={japanese ? "題・チャンネル・話題を検索" : "Search titles, channels and topics"}
          aria-label={japanese ? "動画を検索" : "Search videos"}
        />
        <button type="submit" className="v2-search__submit">{japanese ? "検索" : "Search"}</button>
      </form>

      {active.length ? (
        <p className="v2-note">
          {active.map((label) => <span key={label} className="v2-badge">{label}</span>)}
          {" "}
          <Link className="v2-card__link" href={href({ provider: "", category: "", length: "", date: "", lang: "", q: "" })}>{japanese ? "絞り込みを解除" : "Clear"}</Link>
        </p>
      ) : null}

      <details className="v2-filter-disclosure">
        <summary>{japanese ? "絞り込み" : "Filter"}</summary>
        <div className="v2-filter-disclosure__body">
          <div>
            <p className="v2-filter-disclosure__label">{japanese ? "並び" : "Order"}</p>
            <ul className="v2-facets">
              {MODES.filter((item) => ["recent", "popular", "rising"].includes(item.id)).map((item) => (
                <li key={item.id}><Link className="v2-facet" href={href({ mode: item.id })} aria-current={mode === item.id ? "page" : undefined}>{japanese ? item.ja : item.en}</Link></li>
              ))}
            </ul>
          </div>
          <div>
            <p className="v2-filter-disclosure__label">{japanese ? "配信元" : "Source"}</p>
            <ul className="v2-facets">
              <li><Link className="v2-facet" href={href({ provider: "" })} aria-current={!filters.provider ? "page" : undefined}>{japanese ? "すべて" : "All"}</Link></li>
              {count("provider").map(([provider, n]) => (
                <li key={provider}><Link className="v2-facet" href={href({ provider })} aria-current={filters.provider === provider ? "page" : undefined}>{V2_PROVIDER_LABELS[provider as keyof typeof V2_PROVIDER_LABELS] ?? provider}<span>{n}</span></Link></li>
              ))}
            </ul>
          </div>
          <div>
            <p className="v2-filter-disclosure__label">{japanese ? "分類" : "Category"}</p>
            <ul className="v2-facets">
              <li><Link className="v2-facet" href={href({ category: "" })} aria-current={!filters.category ? "page" : undefined}>{japanese ? "すべて" : "All"}</Link></li>
              {count("category").map(([category, n]) => (
                <li key={category}><Link className="v2-facet" href={href({ category })} aria-current={filters.category === category ? "page" : undefined}>{category}<span>{n}</span></Link></li>
              ))}
            </ul>
          </div>
          <form className="v2-filter" action="/v2/videos" method="get">
            {mode !== "recommended" ? <input type="hidden" name="mode" value={mode} /> : null}
            {filters.provider ? <input type="hidden" name="provider" value={filters.provider} /> : null}
            {filters.category ? <input type="hidden" name="category" value={filters.category} /> : null}
            {filters.query ? <input type="hidden" name="q" value={filters.query} /> : null}
            <label className="v2-filter__row">
              <span>{japanese ? "長さ" : "Length"}</span>
              <select name="length" defaultValue={filters.length}>
                <option value="">{japanese ? "指定なし" : "Any"}</option>
                <option value="under4">{japanese ? "4分未満" : "Under 4 min"}</option>
                <option value="4to20">{japanese ? "4〜20分" : "4–20 min"}</option>
                <option value="over20">{japanese ? "20分以上" : "Over 20 min"}</option>
              </select>
            </label>
            <label className="v2-filter__row">
              <span>{japanese ? "日付" : "Date"}</span>
              <select name="date" defaultValue={filters.date}>
                <option value="">{japanese ? "指定なし" : "Any"}</option>
                <option value="week">{japanese ? "1週間" : "This week"}</option>
                <option value="month">{japanese ? "1か月" : "This month"}</option>
                <option value="year">{japanese ? "1年" : "This year"}</option>
              </select>
            </label>
            <label className="v2-filter__row">
              <span>{japanese ? "言語" : "Language"}</span>
              <select name="lang" defaultValue={filters.language}>
                <option value="">{japanese ? "指定なし" : "Any"}</option>
                <option value="ja">{japanese ? "日本語" : "Japanese"}</option>
                <option value="latin">{japanese ? "英語など" : "Latin script"}</option>
              </select>
            </label>
            <button type="submit" className="v2-toggle v2-toggle--text">{japanese ? "絞り込む" : "Apply"}</button>
          </form>
        </div>
      </details>

      {home ? <V2ShortShelf videos={catalog.videos.filter((video) => video.broadcastStatus !== "live" && video.broadcastStatus !== "upcoming")} locale={locale} href="/v2/videos/shorts" /> : null}

      <V2RemoteHubVideos videos={remoteVideos} locale={locale} />

      {mode === "subscriptions" ? (currentProfile.id
        ? <V2VideoList key={`subscriptions:${subscribed.length}`} initialVideos={subscribed} initialTotal={subscribed.length} filters={{ ...filters, shorts: false }} mode="recent" authenticated locale={locale} />
        : <p className="v2-note v2-reply-auth"><Link href="/v2/auth">{japanese ? "ログイン" : "Sign in"}</Link>{japanese ? "するとフォロー中の新着が出ます。" : " to see new videos from your subscriptions."}</p>
      ) : mode === "recommended" ? <V2RecommendedVideos key={JSON.stringify(filters)} filters={filters} authenticated={Boolean(currentProfile.id)} locale={locale} /> : <V2VideoList
        key={`${mode}:${JSON.stringify(filters)}`}
        initialVideos={catalog.videos}
        initialTotal={catalog.total}
        filters={filters}
        mode={mode as V2VideoMode}
        authenticated={Boolean(currentProfile.id)}
        locale={locale}
      />}
    </V2Shell>
  );
}
