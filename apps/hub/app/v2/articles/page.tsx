import type { Metadata } from "next";
import Link from "next/link";

import { Tabs } from "@/components/v2/ui";
import { V2ArticleList, type V2ArticleSort } from "@/components/v2/v2-article-list";
import { V2MoreMenu } from "@/components/v2/v2-more-menu";
import { V2Aside } from "@/components/v2/v2-aside";
import { V2ColumnHead } from "@/components/v2/v2-columns";
import { V2Shell } from "@/components/v2/v2-shell";
import { V2MediaChips } from "@/components/v2/v2-media-chips";
import { V2MediaColumn } from "@/components/v2/v2-media-column";
import { loadV2MediaColumn } from "@/lib/server/v2-media-column";
import { getAppShellData } from "@/lib/server/app-shell-data";
import { decodeArticleCursor, encodeArticleCursor, listUserArticlePage } from "@/lib/server/d1-user-article-queries";
import { listFollowedTags } from "@/lib/server/d1-user-article-tag-follows";
import { articleCardExtras } from "@/lib/v2-article-card-extras";
import { likeCountsForArticles } from "@/lib/server/d1-user-article-engagement";
import { listArticleDiscoveryTags } from "@/lib/server/article-discovery";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { V2LibraryColumn } from "@/components/v2/v2-library-column";
import { loadViewerLibrary } from "@/lib/server/library-column";
import { getHubLocale } from "@/lib/server/locale";
import { articleKind, matchesArticleKind, memberArticleContent, publicArticleCatalog, type V2ArticleAccess, type V2ArticleKind } from "@/lib/v2-articles";
import { v2NavItems } from "@/lib/v2-nav";

import "../v2.css";
import "../redesign-media.css";
import "../v2-article-list.css";
import "@/app/v2/v2-luxe.css";
import "@/app/v2/v2-luxe-pages.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "記事 | Hub v2",
};

const ACCESS: { id: V2ArticleAccess; ja: string; en: string }[] = [
  { id: "all", ja: "すべて", en: "All" },
  { id: "public", ja: "無料", en: "Free" },
];

const SORTS: { id: V2ArticleSort; ja: string; en: string }[] = [
  { id: "recommended", ja: "おすすめ", en: "Recommended" },
  { id: "latest", ja: "新着", en: "Latest" },
];
const KINDS: { id: V2ArticleKind; ja: string; en: string }[] = [
  { id: "authored", ja: "作者の記事", en: "Authored articles" },
  { id: "encyclopedia", ja: "百科項目", en: "Encyclopedia" },
  { id: "all", ja: "すべて", en: "All" },
];

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/*
 * v2 の記事一覧。既存の /articles には触れない。
 * Hubの書き手の記事（D1）と Hubpedia の無料記事はサーバーで渡す。
 * 内側左列: 公開方法2つ、書く、探す（販売中・成人向けは既存の画面）。
 */
export default async function V2ArticlesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const locale = await getHubLocale();
  const japanese = locale === "ja";
  const requestedAccess = one(params.access);
  const access: V2ArticleAccess = ACCESS.some((item) => item.id === requestedAccess) ? requestedAccess as V2ArticleAccess : "all";
  const requestedSort = one(params.sort);
  const sort: V2ArticleSort = SORTS.some((item) => item.id === requestedSort) ? requestedSort as V2ArticleSort : "recommended";
  const query = one(params.q).trim().slice(0, 120);
  const kind = articleKind(one(params.kind));
  const tag = one(params.tag).trim().slice(0, 60);
  const cursor = decodeArticleCursor(one(params.cursor));
  const wantsFollowing = one(params.feed) === "following";

  const database = getOptionalHubD1();
  const [shell, memberTags] = await Promise.all([
    getAppShellData(),
    database ? listArticleDiscoveryTags(database).catch(() => null) : Promise.resolve(null),
  ]);
  const viewerId = shell.currentProfile.id || null;
  /* 「フォロー中」の流れ（ログイン時だけ）。書き手のフォロー＋タグのフォローを新しい順に1本で出す。 */
  const feedFollowing = wantsFollowing && Boolean(viewerId);
  /* 一覧の本体はサーバーで取る。検索語・タグもSQLで絞り、続きは (created_at, id) のkeysetで引く。 */
  const emptyPage = { articles: [], nextCursor: null };
  const showFollowing = Boolean(viewerId) && !feedFollowing && !query && !tag && !cursor && kind !== "encyclopedia";
  const [page, followed, followedTags] = await Promise.all([
    database && feedFollowing
      ? listUserArticlePage(database, { audience: "general", limit: 24, viewerProfileId: viewerId, query, tag, followingFeed: viewerId, before: cursor }).catch(() => emptyPage)
      : database && kind !== "encyclopedia"
      ? listUserArticlePage(database, { audience: "general", limit: 24, viewerProfileId: viewerId, query, tag, before: cursor }).catch(() => emptyPage)
      : Promise.resolve(emptyPage),
    database && showFollowing
      ? listUserArticlePage(database, { audience: "general", limit: 6, viewerProfileId: viewerId, followedBy: viewerId }).catch(() => emptyPage)
      : Promise.resolve(emptyPage),
    database && feedFollowing && viewerId ? listFollowedTags(database, viewerId).catch(() => [] as string[]) : Promise.resolve([] as string[]),
  ]);
  const members = page.articles;
  const articles = feedFollowing ? members.map(memberArticleContent) : [...members.map(memberArticleContent), ...(cursor ? [] : await publicArticleCatalog())];
  const likeCounts = database ? await likeCountsForArticles(database, [...page.articles, ...followed.articles].map((article) => article.id)) : undefined;
  const extras = articleCardExtras(members, likeCounts);
  const followedContent = followed.articles.map(memberArticleContent);
  const followedExtras = articleCardExtras(followed.articles, likeCounts);
  const column = await loadV2MediaColumn(viewerId, "articles");
  const items = v2NavItems(japanese, { notifications: shell.unreadIndicatorCount, messages: shell.unreadMessageCount });

  const href = (patch: { access?: string; q?: string; tag?: string; sort?: string; kind?: string; cursor?: string; feed?: string }) => {
    const merged = { feed: feedFollowing ? "following" : "", access: access === "all" ? "" : access, q: query, tag, sort: sort === "recommended" ? "" : sort, kind: kind === "authored" ? "" : kind, ...patch };
    const normalizedSort = merged.sort === "recommended" ? "" : merged.sort;
    const next = new URLSearchParams();
    if (merged.feed) next.set("feed", merged.feed);
    if (merged.access) next.set("access", merged.access);
    if (merged.q) next.set("q", merged.q);
    if (merged.tag) next.set("tag", merged.tag);
    if (normalizedSort) next.set("sort", normalizedSort);
    if (merged.kind && merged.kind !== "authored") next.set("kind", merged.kind);
    if (patch.cursor) next.set("cursor", patch.cursor);
    const search = next.toString();
    return `/v2/articles${search ? `?${search}` : ""}`;
  };

  /* タグの面。数の多い順。参考にした索引サイト（apps/adult-affiliate）は左の帯にタグと数を並べ、そこから探させる。 */
  const tagCounts = new Map<string, number>((kind === "encyclopedia" ? [] : memberTags ?? []).map(item => [item.tag, item.count]));
  for (const article of articles.filter(item => item.source !== "member" && matchesArticleKind(item, kind))) for (const item of new Set(article.tags ?? [])) tagCounts.set(item, (tagCounts.get(item) ?? 0) + 1);
  const tags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ja"));

  const everything = !feedFollowing && !tag && !query && !cursor;
  const library = await loadViewerLibrary(viewerId, "articles", japanese);
  const directory = (
    <>
    <V2MediaColumn
      kind="articles"
      japanese={japanese}
      topRows={[{ key: "home", label: japanese ? "ホーム" : "Home", icon: "home", href: "/v2/articles", selected: everything },
        ...(viewerId ? [
          { key: "saved", label: japanese ? "保存した記事" : "Saved articles", icon: "bookmark" as const, href: "/v2/articles/saved" },
          { key: "drafts", label: japanese ? "下書き" : "Drafts", icon: "edit" as const, href: "/v2/articles/drafts" },
        ] : []),
      ]}
      initial={column.initial}

    />
    <V2LibraryColumn data={library} signedIn={Boolean(viewerId)} japanese={japanese} next="/v2/articles" />
    </>
  );
  const chips = [
    { key: "all", label: japanese ? "すべて" : "All", href: href({ tag: "", q: "", cursor: "", feed: "" }), selected: everything },
    ...tags.slice(0, 12).map(([item]) => ({ key: `c:${item}`, label: item, href: href({ tag: item, q: "", cursor: "", feed: "" }), selected: tag === item })),
    ...column.followedTags.filter((item) => !tags.slice(0, 12).some(([name]) => name === item)).map((item) => ({ key: `t:${item}`, label: `#${item}`, href: href({ tag: item, q: "", cursor: "", feed: "" }), selected: tag === item })),
  ];

  return (
    <V2Shell skin="luxe"
      currentPath="/v2/articles"
      profile={shell.currentProfile}
      items={items}
      directory={viewerId ? directory : undefined}
      aside={<V2Aside posts={shell.socialPosts} japanese={japanese} signedIn={Boolean(shell.currentProfile.id)} viewerId={shell.currentProfile.id} title={japanese ? "並べて見る" : "Alongside"} />}
      japanese={japanese}
    >
      <V2ColumnHead
        heading
        title={japanese ? "記事" : "Articles"}
        action={<>
          <Link className="v2-button v2-button--primary v2-articles-write" href="/v2/articles/new"><span className="v2-button__label">{japanese ? "書く" : "Write"}</span></Link>
          {viewerId ? <V2MoreMenu label={japanese ? "自分の記事" : "My articles"} items={[
            { href: "/v2/articles/drafts", label: japanese ? "下書き" : "Drafts" },
            { href: "/v2/articles/stats", label: japanese ? "統計" : "Stats" },
            { href: "/v2/articles/series", label: japanese ? "シリーズ" : "Series" },
            { href: "/v2/articles/magazines", label: japanese ? "マガジン" : "Magazines" },
          ]} /> : null}
        </>}
      />

      <Tabs
        className="v2-l5-tabs v2-articles-tabs"
        label={japanese ? "表示する記事" : "Article feed"}
        value={feedFollowing ? "following" : sort === "latest" ? "latest" : "recommended"}
        items={[
          { id: "recommended", label: japanese ? "おすすめ" : "Recommended", href: href({ feed: "", sort: "recommended", q: "", tag: "", cursor: "" }) },
          { id: "latest", label: japanese ? "新着" : "Latest", href: href({ feed: "", sort: "latest", q: "", tag: "", cursor: "" }) },
          ...(viewerId ? [{ id: "following", label: japanese ? "フォロー中" : "Following", href: href({ feed: "following", q: "", tag: "", cursor: "" }) }] : []),
          { id: "saved", label: japanese ? "保存" : "Saved", href: "/v2/articles/saved" },
        ]}
      />

      <V2MediaChips label={japanese ? "記事のタグ" : "Article tags"} chips={chips} japanese={japanese} />

      <div className="v2-articles-searchrow">
      <form className="v2-search__form v2-articles-search" role="search" action="/v2/articles" method="get">
        {feedFollowing ? <input type="hidden" name="feed" value="following" /> : null}
        {sort !== "recommended" ? <input type="hidden" name="sort" value={sort} /> : null}
        {kind !== "authored" ? <input type="hidden" name="kind" value={kind} /> : null}
        {access !== "all" ? <input type="hidden" name="access" value={access} /> : null}
        {tag ? <input type="hidden" name="tag" value={tag} /> : null}
        <input
          type="search"
          name="q"
          defaultValue={query}
          maxLength={120}
          placeholder={japanese ? "記事名・著者・タグを検索" : "Search titles, authors and tags"}
          aria-label={japanese ? "記事を検索" : "Search articles"}
        />
        <button type="submit" className="v2-search__submit">{japanese ? "検索" : "Search"}</button>
      </form>
      <details className="v2-filter-disclosure v2-articles-filter">
        <summary>{japanese ? "絞り込み" : "Filter"}</summary>
        <div className="v2-filter-disclosure__body">
          {feedFollowing ? null : <><div>
            <p className="v2-filter-disclosure__label">{japanese ? "読む内容" : "Reading"}</p>
            <ul className="v2-facets">
              {KINDS.map(item => <li key={item.id}><Link className="v2-facet" href={href({ kind: item.id, tag: "", access: item.id === "encyclopedia" || access === "all" ? "" : access })} aria-current={kind === item.id ? "page" : undefined}>{japanese ? item.ja : item.en}</Link></li>)}
            </ul>
          </div>
          <div>
            <p className="v2-filter-disclosure__label">{japanese ? "公開方法" : "Access"}</p>
            <ul className="v2-facets">
              {ACCESS.map((item) => <li key={item.id}><Link className="v2-facet" href={href({ access: item.id === "all" ? "" : item.id })} aria-current={item.id === access ? "page" : undefined}>{japanese ? item.ja : item.en}</Link></li>)}
            </ul>
          </div></>}
          {memberTags === null ? <p className="v2-note">{japanese ? "記事のタグを取得できませんでした。" : "Could not load article tags."}</p> : null}
          {tags.length ? (
            <div>
              <p className="v2-filter-disclosure__label">{japanese ? "タグ" : "Tags"}</p>
              <ul className="v2-facets">
                {tags.slice(0, 40).map(([item, n]) => (
                  <li key={item}><Link className="v2-facet" href={href({ tag: tag === item ? "" : item })} aria-current={tag === item ? "page" : undefined}>{item}<span>{n}</span></Link></li>
                ))}
              </ul>
            </div>
          ) : null}
          <div>
            <p className="v2-filter-disclosure__label">{japanese ? "ほかの場所" : "Elsewhere"}</p>
            <ul className="v2-facets">
              <li><Link className="v2-facet" href="/v2/market/digital?view=articles">{japanese ? "販売中の記事" : "Articles for sale"}</Link></li>
            </ul>
          </div>
        </div>
      </details>
      </div>

      {feedFollowing ? (
        <p className="v2-note">
          {followedTags.length
            ? <>{japanese ? "フォロー中のタグ：" : "Tags you follow: "}{followedTags.slice(0, 12).map((item) => <Link key={item} className="v2-card__link" href={`/v2/articles/tags/${encodeURIComponent(item)}`}>#{item} </Link>)}{followedTags.length > 12 ? `…${followedTags.length - 12}` : null}</>
            : (japanese ? "タグはまだフォローしていません。タグの頁でフォローすると、ここに流れます。" : "You do not follow any tags yet. Follow a tag on its page to see its articles here.")}
        </p>
      ) : null}



      {query || tag ? (
        <p className="v2-note">
          {tag ? <span className="v2-badge">{tag}</span> : null}
          {query ? <span className="v2-badge">{query}</span> : null}{" "}
          <Link className="v2-card__link" href={href({ q: "", tag: "" })}>{japanese ? "絞り込みを解除" : "Clear"}</Link>
        </p>
      ) : null}

      {followedContent.length ? (
        <section className="v2-following-articles" aria-labelledby="v2-following-articles-title">
          <h2 id="v2-following-articles-title" className="v2-following-articles__title">{japanese ? "フォロー中の書き手" : "From writers you follow"}</h2>
          <V2ArticleList articles={followedContent} kind="authored" access="public" query="" sort="latest" locale={locale} extras={followedExtras} emptyAction={false} />
        </section>
      ) : null}

      <V2ArticleList key={`${feedFollowing ? "following" : ""}:${kind}:${access}:${query}:${tag}:${sort}:${cursor ? encodeArticleCursor(cursor) : ""}`} articles={articles} kind={feedFollowing ? "authored" : kind} access={feedFollowing ? "public" : access} query={feedFollowing ? "" : query} tag={feedFollowing ? "" : tag} sort={feedFollowing ? "latest" : sort} locale={locale} extras={extras} emptyAction={!feedFollowing} nextHref={page.nextCursor ? href({ cursor: encodeArticleCursor(page.nextCursor) }) : null} />
    </V2Shell>
  );
}
