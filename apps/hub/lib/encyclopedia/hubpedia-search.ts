import articleReadings from "./article-readings.generated.json";
import type { ViewableSeedArticle } from "./seed";
import { getHubpediaTrendScore, rankHubpediaArticles } from "./hubpedia-trends";
import { getHubpediaSearchOverride } from "./hubpedia-search-overrides";
import { normalizeHubpediaSearchText, scoreHubpediaSearchFields } from "./search-text";
import { getAutomaticArticleTags } from "./automatic-tags";

const readingsBySlug = articleReadings as Readonly<Record<string, string>>;

export { normalizeHubpediaSearchText } from "./search-text";

export function getHubpediaArticleReading(slug: string) {
  const generated = readingsBySlug[slug] ?? "";
  const override = getHubpediaSearchOverride(slug)?.reading;
  return [...new Set([generated, override].filter(Boolean))].join(" ");
}

export function getHubpediaArticleAliases(slug: string) {
  return [...(getHubpediaSearchOverride(slug)?.aliases ?? [])];
}

export function getHubpediaArticleSearchText(article: ViewableSeedArticle) {
  const translatedText = Object.values(article.translations ?? {})
    .map((translation) => `${translation.title} ${translation.summary}`)
    .join(" ");

  return normalizeHubpediaSearchText([
    article.title,
    article.canonicalName,
    article.summary,
    article.description,
    translatedText,
    getHubpediaArticleReading(article.slug),
    getHubpediaArticleAliases(article.slug).join(" "),
    getAutomaticArticleTags(article).join(" "),
    article.slug,
  ].join(" "));
}

export function scoreHubpediaArticleQuery(article: ViewableSeedArticle, query: string) {
  const translatedTitles = Object.values(article.translations ?? {}).map((translation) => translation.title);
  return scoreHubpediaSearchFields({
    title: article.title,
    reading: getHubpediaArticleReading(article.slug),
    aliases: [article.canonicalName, article.slug, ...translatedTitles, ...getHubpediaArticleAliases(article.slug)],
    category: `${article.categoryLabel} ${getAutomaticArticleTags(article).join(" ")}`,
    summary: article.summary,
    description: article.description,
  }, query);
}

export function hubpediaArticleMatchesQuery(article: ViewableSeedArticle, query: string) {
  return scoreHubpediaArticleQuery(article, query) > 0;
}

export function rankHubpediaArticlesForQuery<T extends ViewableSeedArticle>(articles: readonly T[], query: string) {
  if (!normalizeHubpediaSearchText(query)) return rankHubpediaArticles(articles);
  return [...articles].sort((left, right) =>
    scoreHubpediaArticleQuery(right, query) - scoreHubpediaArticleQuery(left, query)
      || getHubpediaTrendScore(right) - getHubpediaTrendScore(left)
      || left.title.localeCompare(right.title, "ja"),
  );
}
