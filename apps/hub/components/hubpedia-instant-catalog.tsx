"use client";

import React, { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { hubSurfacePath, useHubUiSurface } from "@/lib/use-hub-ui-surface";

import { removeRepeatedTitleFromSummary } from "@/lib/encyclopedia/summary-display";

type CatalogArticle = {
  slug: string;
  title: string;
  summary: string;
  categoryIds: string[];
};

type CategorySelection = {
  selectedCategory: string;
  selectCategory: (category: string) => void;
};

const CategorySelectionContext = createContext<CategorySelection | null>(null);

export function HubpediaInstantCategoryProvider({
  initialCategory,
  children,
}: {
  initialCategory: string;
  children: ReactNode;
}) {
  const [selectedCategory, setSelectedCategory] = useState(initialCategory);

  useEffect(() => {
    const restoreCategory = () => setSelectedCategory(new URL(window.location.href).searchParams.get("category") ?? "");
    window.addEventListener("popstate", restoreCategory);
    return () => window.removeEventListener("popstate", restoreCategory);
  }, []);

  const selectCategory = (category: string) => {
    setSelectedCategory(category);
    const url = new URL(window.location.href);
    if (category) url.searchParams.set("category", category);
    else url.searchParams.delete("category");
    url.searchParams.delete("page");
    window.history.pushState({}, "", `${url.pathname}${url.search}${url.hash}`);
  };

  return (
    <CategorySelectionContext.Provider value={{ selectedCategory, selectCategory }}>
      {children}
    </CategorySelectionContext.Provider>
  );
}

export function useHubpediaCategorySelection() {
  const value = useContext(CategorySelectionContext);
  if (!value) throw new Error("Hubpedia category controls require HubpediaInstantCategoryProvider.");
  return value;
}

export function HubpediaInstantCategoryLink({
  category,
  children,
  className,
  hrefFor,
  current = false,
}: {
  category: string;
  children: ReactNode;
  className?: string;
  /* 行き先を外から決めるとき、今いる分類かどうかは親が決める（提供者を読まない）。 */
  current?: boolean;
  /*
   * 行き先を外から決める（2026-09-04）。v2 の Hubpedia は URL で絞り込むので、
   * 押した瞬間にクライアントで差し替える即時の切り替えは噛み合わない
   * （札は光るのに一覧が動かない）。渡されたら素のリンクとして描く。
   */
  hrefFor?: (category: string) => string;
}) {
  /*
   * 提供者は即時切り替えのときだけ要る（2026-09-07）。行き先を外から決めるときに
   * 必須にしていたら、v2 の Hubpedia は分類の木を開いた瞬間に落ちた
   * （提供者を置かないので）。素のリンクに提供者は要らない。
   */
  const selection = useContext(CategorySelectionContext);
  if (!hrefFor && !selection) throw new Error("Hubpedia category controls require HubpediaInstantCategoryProvider.");
  const href = hrefFor ? hrefFor(category) : (category ? `/hubpedia?category=${encodeURIComponent(category)}` : "/hubpedia");
  const isCurrent = hrefFor ? current : selection?.selectedCategory === category;
  return (
    <a
      className={className}
      href={href}
      aria-current={isCurrent ? "page" : undefined}
      onClick={(event) => {
        /* 行き先を外から決めているときは素のリンク。押した先で読み直す。 */
        if (hrefFor || !selection) return;
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        selection.selectCategory(category);
      }}
    >
      {children}
    </a>
  );
}

export function HubpediaInstantArticleList({
  articles,
  en,
  heading,
  sortControls,
  pageSize = 30,
}: {
  articles: CatalogArticle[];
  en: boolean;
  heading: string;
  sortControls?: ReactNode;
  pageSize?: number;
}) {
  /* 読み手が居る面。v2 から描かれたら行き先も v2 へ（2026-09-07）。 */
  const surface = useHubUiSurface();
  const { selectedCategory } = useHubpediaCategorySelection();
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [selectedCategory]);
  const filtered = useMemo(
    () => selectedCategory ? articles.filter((article) => article.categoryIds.includes(selectedCategory)) : articles,
    [articles, selectedCategory],
  );
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const visible = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const moveToPage = (nextPage: number) => {
    setPage(nextPage);
    document.querySelector(".hubpedia__feed")?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  return (
    <section className="hubpedia__section hubpedia__feed">
      <div className="hubpedia__heading hubpedia__article-heading">
        <div><h2>{heading}</h2><span>{filtered.length}{en ? "" : "件"}</span></div>
        {sortControls}
      </div>
      <div className="hubpedia__articles hubpedia__dictionary">
        {visible.map((article) => (
          <article key={article.slug}>
            <div className="hubpedia__entry-main">
              <h3><a href={hubSurfacePath(surface, `/hubpedia/${article.slug}`)}>{article.title}</a></h3>
              <p className="hubpedia__definition">{removeRepeatedTitleFromSummary(article.title, article.summary)}</p>
            </div>
          </article>
        ))}
      </div>
      {filtered.length === 0 ? <div className="empty-state"><p>{en ? "No articles match this category." : "このカテゴリの記事はありません。"}</p></div> : null}
      {totalPages > 1 ? (
        <nav className="hubpedia__pagination" aria-label={en ? "Article pages" : "記事一覧のページ"}>
          <button type="button" disabled={currentPage === 1} onClick={() => moveToPage(currentPage - 1)}>{en ? "Previous" : "前へ"}</button>
          <strong>{currentPage} / {totalPages}</strong>
          <button type="button" disabled={currentPage === totalPages} onClick={() => moveToPage(currentPage + 1)}>{en ? "Next" : "次へ"}</button>
        </nav>
      ) : null}
    </section>
  );
}
