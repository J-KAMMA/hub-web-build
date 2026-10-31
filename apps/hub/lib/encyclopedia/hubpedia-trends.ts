import type { ViewableSeedArticle } from "./seed";
import { rankHubObjects } from "@/lib/platform/hub-object-ranking";

type TrendableArticle = Pick<
  ViewableSeedArticle,
  "priority" | "reviewStatus" | "sources" | "title" | "contentStage" | "popularityBasis"
>;

export function getHubpediaTrendScore(article: TrendableArticle) {
  if (article.contentStage === "stub") return 2;
  return (article.reviewStatus === "completed" ? 30 : article.reviewStatus === "review-required" ? 20 : article.reviewStatus === "sources-required" ? 8 : 3)
    + Math.min(article.sources.length * 3, 15)
    + Math.max(0, 10 - (article.priority ?? 10))
    + Math.log10(Math.max(1, article.popularityBasis?.views ?? 1)) * 12;
}

export function rankHubpediaArticles<T extends TrendableArticle>(articles: readonly T[]) {
  return rankHubObjects(
    articles.map((article) => ({
      ref: { namespace: "hubpedia", kind: "article", id: article.title },
      value: article,
      baseScore: getHubpediaTrendScore(article),
      stableKey: article.title.normalize("NFKC"),
      diversityKeys: { source: article.popularityBasis?.source },
    })),
    { surface: "knowledge_feed" },
  ).map((entry) => entry.value);
}
