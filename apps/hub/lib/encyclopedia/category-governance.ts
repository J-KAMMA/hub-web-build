import { inferArticleEntityType } from "./article-structure-policy";
import { buildEvolvingCategoryIndex, type DynamicCategoryNode } from "./category-evolution";
import { getArticleCategoryIds, getEncyclopediaCategoryNode } from "./categories";
import type { ViewableSeedArticle } from "./seed";

export type ArticleFacets = { field: string[]; entityType: string; periods: string[]; regions: string[] };
const regionPattern = /日本|中国|韓国|アジア|ヨーロッパ|アフリカ|北米|南米|中東|Japan|China|Korea|Asia|Europe|Africa|America/giu;
const periodPattern = /(?:\d{1,4}年代|\d{1,2}世紀|古代|中世|近世|近代|現代|ancient|medieval|modern|\d{1,2}(?:st|nd|rd|th) century)/giu;

export function getArticleFacets(article: ViewableSeedArticle): ArticleFacets {
  const text = `${article.title} ${article.summary} ${article.categoryLabel} ${article.bodyMarkdown}`;
  return {
    field: getArticleCategoryIds(article).filter((id) => id !== "maintenance/uncategorized"),
    entityType: inferArticleEntityType(article),
    periods: [...new Set(text.match(periodPattern) ?? [])].slice(0, 6),
    regions: [...new Set(text.match(regionPattern) ?? [])].slice(0, 6),
  };
}

export function auditCategoryGovernance(articles: readonly ViewableSeedArticle[]) {
  const index = buildEvolvingCategoryIndex(articles);
  const duplicateNames = new Map<string, string[]>();
  for (const node of index.dynamicNodes) {
    const key = node.name.normalize("NFKC").toLocaleLowerCase("ja");
    duplicateNames.set(key, [...(duplicateNames.get(key) ?? []), node.id]);
  }
  return {
    counts: {
      candidate: index.dynamicNodes.filter((node) => node.state === "candidate").length,
      visible: index.dynamicNodes.filter((node) => node.state === "visible").length,
      established: index.dynamicNodes.filter((node) => node.state === "established").length,
    },
    pendingAiReview: index.dynamicNodes.filter((node) => node.requiresAiReview),
    duplicateNames: [...duplicateNames.entries()].filter(([, ids]) => ids.length > 1).map(([name, ids]) => ({ name, ids })),
    oversized: index.dynamicNodes.filter((node) => node.articleCount > Math.max(50, articles.length * 0.4)),
    uncategorizedSlugs: articles.filter((article) => getArticleCategoryIds(article).includes("maintenance/uncategorized")).map((article) => article.slug),
    facets: articles.map((article) => ({ slug: article.slug, ...getArticleFacets(article) })),
  };
}

export function createCategoryAiReviewFrame(candidate: DynamicCategoryNode, articleTitles: readonly string[]) {
  return {
    system: "Review an encyclopedia category proposal. Approve only a defining, neutral, reusable category with a natural noun-phrase name and a correct parent. Reject incidental themes, duplicates, essay-like labels, and overly narrow categories. Return JSON only.",
    prompt: JSON.stringify({ candidate, parent: getEncyclopediaCategoryNode(candidate.parentId ?? ""), articleTitles }),
    outputContract: { decision: "approve | rename | merge | reject", canonicalName: "string", parentId: "existing category ID", aliases: ["string"], reason: "short string" },
  };
}

export function createWikimediaClassificationHints(title: string, aliases: readonly string[] = []) {
  return [...new Set([title, ...aliases].map((value) => value.trim()).filter(Boolean))].map((term) => ({
    term,
    wikipediaSearch: `https://ja.wikipedia.org/w/index.php?search=${encodeURIComponent(term)}`,
    wikidataSearch: `https://www.wikidata.org/w/index.php?search=${encodeURIComponent(term)}`,
    usage: "discovery-only" as const,
  }));
}
