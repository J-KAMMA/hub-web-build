import { ENCYCLOPEDIA_ROOT_CATEGORIES, getArticleCategoryIds } from "@/lib/encyclopedia/categories";
import { rankHubpediaArticlesByRecency } from "@/lib/encyclopedia/hubpedia-recency";
import { hubpediaArticleMatchesQuery, rankHubpediaArticlesForQuery } from "@/lib/encyclopedia/hubpedia-search";
import { rankHubpediaArticles } from "@/lib/encyclopedia/hubpedia-trends";
import type { ReaderCatalogArticle } from "@/lib/encyclopedia/repository";

/*
 * v2 の Hubpedia 一覧。既存の /hubpedia から機能だけを抜いた:
 * 語での絞り込み（hubpediaArticleMatchesQuery）、並び3種（おすすめ＝語の関連度、
 * 新着＝公開順、人気＝傾向）、大分類での絞り込み、40件ずつの頁。
 * 判定と並べ替えは既存の関数を呼ぶ（別実装にしない）。
 */
export type V2HubpediaSort = "recommended" | "latest" | "popular";
export const V2_HUBPEDIA_PAGE_SIZE = 40;

export function v2HubpediaSort(value: unknown): V2HubpediaSort {
  return value === "latest" || value === "popular" ? value : "recommended";
}

export function v2HubpediaRootCategories() {
  return ENCYCLOPEDIA_ROOT_CATEGORIES.map((category) => ({ id: category.id, name: category.name }));
}

export function v2HubpediaArticleRootCategory(article: ReaderCatalogArticle): string | null {
  const ids = getArticleCategoryIds(article);
  const root = ids.map((id) => id.split("/")[0]).find((id) => ENCYCLOPEDIA_ROOT_CATEGORIES.some((category) => category.id === id));
  return root ?? null;
}

export function v2HubpediaSelect(
  catalog: readonly ReaderCatalogArticle[],
  input: { query: string; sort: V2HubpediaSort; category: string; recentSlugs: readonly string[] },
): ReaderCatalogArticle[] {
  const matching = catalog.filter((article) => {
    if (input.query && !hubpediaArticleMatchesQuery(article, input.query)) return false;
    if (input.category && v2HubpediaArticleRootCategory(article) !== input.category) return false;
    return true;
  });
  if (input.sort === "latest") return rankHubpediaArticlesByRecency(matching, input.recentSlugs);
  if (input.sort === "popular") return rankHubpediaArticles(matching);
  return input.query ? rankHubpediaArticlesForQuery(matching, input.query) : rankHubpediaArticles(matching);
}
