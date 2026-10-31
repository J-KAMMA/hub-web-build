export function rankHubpediaArticlesByRecency<T extends { slug: string }>(
  articles: readonly T[],
  recentPublicationSlugs: readonly string[],
) {
  const recentRank = new Map(recentPublicationSlugs.map((slug, index) => [slug, index]));

  return articles
    .map((article, originalIndex) => ({ article, originalIndex }))
    .sort((left, right) => {
      const leftRank = recentRank.get(left.article.slug);
      const rightRank = recentRank.get(right.article.slug);
      if (leftRank !== undefined || rightRank !== undefined) {
        return (leftRank ?? Number.MAX_SAFE_INTEGER) - (rightRank ?? Number.MAX_SAFE_INTEGER);
      }
      return left.originalIndex - right.originalIndex;
    })
    .map(({ article }) => article);
}
