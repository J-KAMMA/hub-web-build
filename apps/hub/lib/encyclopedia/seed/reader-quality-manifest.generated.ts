

export interface ReaderQualityUpgrade {
  slug: string;
  ja: { title: string; summary: string; bodyMarkdown: string };
  en: { title: string; summary: string; bodyMarkdown: string };
}

export const READER_QUALITY_BATCHES: ReadonlyArray<{
  fileName: string;
  articles: ReaderQualityUpgrade[];
}> = [

];

export const READER_QUALITY_ARTICLES = READER_QUALITY_BATCHES.flatMap((batch) => batch.articles);
export const READER_QUALITY_RECENT_SLUGS = READER_QUALITY_ARTICLES.map((article) => article.slug);
