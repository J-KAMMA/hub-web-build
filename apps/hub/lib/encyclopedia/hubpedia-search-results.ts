import { getPrimaryArticleCategory } from "./categories";
import { normalizeHubpediaSearchText, scoreHubpediaArticleQuery } from "./hubpedia-search";
import { getHubpediaTrendScore, rankHubpediaArticles } from "./hubpedia-trends";
import { getPublicReaderReadySeedArticles } from "./public-seed";

export async function getSeedHubpediaSearchResults(query: string, limit?: number) {
  const PUBLIC_READER_READY_SEED_ARTICLES = await getPublicReaderReadySeedArticles();
  const normalizedQuery = normalizeHubpediaSearchText(query);
  const matches = normalizedQuery
    ? PUBLIC_READER_READY_SEED_ARTICLES
      .map((article) => ({ article, score: scoreHubpediaArticleQuery(article, normalizedQuery) }))
      .filter(({ score }) => score > 0)
      .sort((left, right) =>
        right.score - left.score
        || getHubpediaTrendScore(right.article) - getHubpediaTrendScore(left.article)
        || left.article.title.localeCompare(right.article.title, "ja")
      )
      .map(({ article }) => article)
    : rankHubpediaArticles(PUBLIC_READER_READY_SEED_ARTICLES);
  const results = matches.map((article) => ({
    slug: article.slug,
    title: article.title,
    category: getPrimaryArticleCategory(article).name,
    summary: article.summary,
    href: `/hubpedia/${encodeURIComponent(article.slug)}`,
  }));

  return {
    count: results.length,
    results: limit === undefined ? results : results.slice(0, limit),
  };
}
