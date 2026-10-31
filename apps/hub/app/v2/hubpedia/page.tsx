import type { Metadata } from "next";
import { Tabs } from "@/components/v2/ui";
import { V2MoreMenu } from "@/components/v2/v2-more-menu";
import Link from "next/link";

import { V2Aside } from "@/components/v2/v2-aside";
import { V2HubpediaDiscovery } from "@/components/v2/v2-hubpedia-discovery";
import { V2ColumnHead } from "@/components/v2/v2-columns";
import { V2Shell } from "@/components/v2/v2-shell";
import { getHubpediaRecentPublicationSlugs, getPublicReaderReadySeedArticles } from "@/lib/encyclopedia/public-seed";
import { listPublishedReaderCatalogArticles, mergePublishedReaderCatalog } from "@/lib/encyclopedia/repository";
import { removeRepeatedTitleFromSummary } from "@/lib/encyclopedia/summary-display";
import { getAppShellData } from "@/lib/server/app-shell-data";
import { HubpediaCategoryTree } from "@/components/hubpedia-category-tree";
import { HubpediaMemoryProposalForm } from "@/components/hubpedia-memory-proposal-form";
import { ENCYCLOPEDIA_ROOT_CATEGORIES } from "@/lib/encyclopedia/categories";
import { buildHubpediaCategoryTree } from "@/lib/hubpedia-category-tree-data";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { listHubpediaCategories, loadHubpediaCategoryIndex } from "@/lib/server/hubpedia-category-registry";
import { getHubLocale } from "@/lib/server/locale";
import { V2_HUBPEDIA_PAGE_SIZE, v2HubpediaArticleRootCategory, v2HubpediaRootCategories, v2HubpediaSelect, v2HubpediaSort } from "@/lib/v2-hubpedia";
import { v2NavItems } from "@/lib/v2-nav";

import "../v2.css";
import "../redesign-media.css";
import "@/app/v2/v2-luxe.css";
import "@/app/v2/v2-luxe-pages.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Hubpedia | Hub v2",
};

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/*
 * v2 の Hubpedia 一覧。既存の /hubpedia から機能だけを抜いた: 語での絞り込み、
 * 並び3種、大分類、40件ずつの頁。記事の材料（種＋D1の公開記事）と判定は既存の関数。
 * 分類の木・記事の提案・検索の統計・広告は既存の画面へ渡す（内側左列）。
 */
export default async function V2HubpediaPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [locale, params, shell] = await Promise.all([getHubLocale(), searchParams, getAppShellData()]);
  const japanese = locale === "ja";
  const query = one(params.q).trim().slice(0, 80);
  const sort = v2HubpediaSort(one(params.sort));
  const category = one(params.category).trim().slice(0, 60);
  const pageNumber = Math.max(1, /^\d+$/.test(one(params.page)) ? Number(one(params.page)) : 1);

  const [PUBLIC_READER_READY_SEED_ARTICLES, HUBPEDIA_RECENT_PUBLICATION_SLUGS] = await Promise.all([getPublicReaderReadySeedArticles(), getHubpediaRecentPublicationSlugs()]);
  const databaseResult = await listPublishedReaderCatalogArticles(locale)
    .then(articles => ({ articles, unavailable: false }))
    .catch(() => ({ articles: [], unavailable: true }));
  const databaseArticles = databaseResult.articles;
  const catalog = mergePublishedReaderCatalog(PUBLIC_READER_READY_SEED_ARTICLES, databaseArticles);
  const recentSlugs = [
    ...databaseArticles.map((article) => article.slug),
    ...HUBPEDIA_RECENT_PUBLICATION_SLUGS.filter((slug) => !databaseArticles.some((article) => article.slug === slug)),
  ];
  /*
   * 分類の木（2026-09-04、旦那様の「古いUIを出さない」）。
   * 木の組み立ては既存と同じ lib/hubpedia-category-tree-data.ts。
   * D1 が読めないときは木を出さない——空の枠より、無いほうがいい。
   */
  const database = getOptionalHubD1();
  const categoryTree = database
    ? await (async () => {
        try {
          const index = await loadHubpediaCategoryIndex(database, catalog);
          const records = await listHubpediaCategories(database, locale, "articles");
          return ENCYCLOPEDIA_ROOT_CATEGORIES.map((root) => ({
            ...root,
            children: buildHubpediaCategoryTree(index, records, root.id),
          }));
        } catch {
          return [];
        }
      })()
    : [];

  const selected = v2HubpediaSelect(catalog, { query, sort, category, recentSlugs });
  const roots = v2HubpediaRootCategories();
  const countByRoot = new Map<string, number>();
  for (const article of catalog) {
    const root = v2HubpediaArticleRootCategory(article);
    if (root) countByRoot.set(root, (countByRoot.get(root) ?? 0) + 1);
  }

  const href = (patch: { q?: string; sort?: string; category?: string; page?: string }) => {
    const merged = { q: query, sort: sort === "recommended" ? "" : sort, category, page: "", ...patch };
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(merged)) if (value && !(key === "page" && value === "1")) next.set(key, value);
    const search = next.toString();
    return `/v2/hubpedia${search ? `?${search}` : ""}`;
  };
  const items = v2NavItems(japanese, { notifications: shell.unreadIndicatorCount, messages: shell.unreadMessageCount });
  const SORTS = [
    { id: "recommended", ja: "おすすめ", en: "Recommended" },
    { id: "latest", ja: "新着", en: "Latest" },
    { id: "popular", ja: "人気", en: "Popular" },
  ] as const;

  return (
    <V2Shell skin="luxe"
      currentPath="/v2/hubpedia"
      profile={shell.currentProfile}
      items={items}
      aside={<V2Aside posts={shell.socialPosts} japanese={japanese} signedIn={Boolean(shell.currentProfile.id)} viewerId={shell.currentProfile.id} initialView="search" title={japanese ? "並べて見る" : "Alongside"} />}
      japanese={japanese}
    >
      <V2ColumnHead heading title={japanese ? "資料・知識" : "Reference & Knowledge"} action={<V2MoreMenu label={japanese ? "その他" : "More"} items={[
        { href: "/v2/hubpedia/watchlist", label: japanese ? "ウォッチリスト" : "Watchlist" },
        { href: "/v2/hubpedia/recent-changes", label: japanese ? "最近の変更" : "Recent changes" },
        { href: "/v2/hubpedia/about", label: japanese ? "編集方針" : "Policy" },
      ]} />} />
      <div className="v2-hubpedia-tabrow">
        <Tabs className="v2-l5-tabs" label={japanese ? "並び" : "Order"} value={sort} items={SORTS.map((item) => ({ id: item.id, label: japanese ? item.ja : item.en, href: href({ sort: item.id }) }))} />
        <p className="v2-hubpedia-count">{japanese ? `${selected.length}本` : `${selected.length} articles`}</p>
      </div>

      <div className="v2-hubpedia-toolbar">
      <form className="v2-search__form v2-hubpedia-search" role="search" action="/v2/hubpedia" method="get">
        {sort !== "recommended" ? <input type="hidden" name="sort" value={sort} /> : null}
        {category ? <input type="hidden" name="category" value={category} /> : null}
        <input type="search" name="q" defaultValue={query} maxLength={80} placeholder={japanese ? "題・要約・本文を検索" : "Search titles, summaries and bodies"} aria-label={japanese ? "Hubpedia を検索" : "Search Hubpedia"} />
        <button type="submit" className="v2-search__submit">{japanese ? "検索" : "Search"}</button>
      </form>

      <details className="v2-filter-disclosure v2-hubpedia-filter">
        <summary>{japanese ? "絞り込み" : "Filter"}</summary>
        <div className="v2-filter-disclosure__body">
          <p className="v2-filter-disclosure__label">{japanese ? "分類" : "Categories"}</p>
          {!categoryTree.length ? <ul className="v2-facets">
            <li><Link className="v2-facet" href={href({ category: "" })} aria-current={!category ? "page" : undefined}>{japanese ? "すべて" : "All"}<span>{catalog.length}</span></Link></li>
            {roots.filter((root) => countByRoot.has(root.id)).map((root) => (
              <li key={root.id}>
                <Link className="v2-facet" href={href({ category: root.id })} aria-current={category === root.id ? "page" : undefined}>
                  {root.name}
                  <span>{countByRoot.get(root.id)}</span>
                </Link>
              </li>
            ))}
          </ul> : null}
          {categoryTree.length ? (
            <>
              <HubpediaCategoryTree
                categories={categoryTree}
                selectedCategory={category}
                initialExpandedCategory={category}
                allLabel={japanese ? "すべて" : "All"}
                hrefBase="/v2/hubpedia"
                rootCounts={Object.fromEntries(countByRoot)}
                queryString={new URLSearchParams({ q: query, sort }).toString()}
              />
            </>
          ) : null}
        </div>
      </details>

      <details className="v2-filter-disclosure v2-hubpedia-propose">
        <summary>{japanese ? "記事を提案" : "Propose an article"}</summary>
        <div className="v2-filter-disclosure__body"><div className="v2-hubpedia__propose"><HubpediaMemoryProposalForm /></div></div>
      </details>
      </div>
      {query || category ? <p className="v2-note"><Link className="v2-card__link" href="/v2/hubpedia">{japanese ? "絞り込みを解除" : "Clear"}</Link></p> : null}

      <V2HubpediaDiscovery
        articles={selected.map(article => {
          const root = v2HubpediaArticleRootCategory(article);
          return { slug: article.slug, title: article.title, summary: removeRepeatedTitleFromSummary(article.title, article.summary ?? ""), category: roots.find(item => item.id === root)?.name ?? root ?? "", published: article.sourceLayer === "database" };
        })}
        recommended={sort === "recommended" && !query}
        pageNumber={pageNumber}
        pageSize={V2_HUBPEDIA_PAGE_SIZE}
        queryString={new URLSearchParams({ q: query, sort, category }).toString()}
        japanese={japanese}
        unavailable={databaseResult.unavailable}
      />
    </V2Shell>
  );
}
