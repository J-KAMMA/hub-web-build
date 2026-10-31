type QualityArticle = {
  bodyMarkdown: string;
  collection?: string;
  contentStage?: "stub";
  reviewStatus?: string;
  sources: readonly unknown[];
};

export function getArticleQualityMetrics(article: QualityArticle) {
  const plainLength = article.bodyMarkdown
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[-*>]\s*/gm, "")
    .replace(/\s+/g, "")
    .length;
  return {
    plainLength,
    sectionCount: article.bodyMarkdown.match(/^##\s+/gm)?.length ?? 0,
    internalLinkCount: article.bodyMarkdown.match(/\]\(\/hubpedia\//g)?.length ?? 0,
  };
}

export function isReaderReadyArticle(article: QualityArticle) {
  if (article.contentStage === "stub") return false;
  const metrics = getArticleQualityMetrics(article);
  if (metrics.sectionCount < 4) return false;
  if (article.collection === "curated" || article.sources.length >= 2) return metrics.plainLength >= 400;
  if (article.reviewStatus === "completed") {
    return metrics.plainLength >= 400 && metrics.internalLinkCount >= 2;
  }
  return metrics.plainLength >= 500 && metrics.internalLinkCount >= 2;
}
