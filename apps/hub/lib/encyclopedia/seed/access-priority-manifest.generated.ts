

export interface AccessPriorityArticle {
  slug: string;
  categoryLabel: string;
  topicType: string;
  popularityBasis: {
    source: string;
    project: string;
    period: string;
    views: number;
  };
  ja: { title: string; summary: string; bodyMarkdown: string };
  en: { title: string; summary: string; bodyMarkdown: string };
}

export const ACCESS_PRIORITY_BATCHES: ReadonlyArray<{
  fileName: string;
  articles: AccessPriorityArticle[];
}> = [

];

export const ACCESS_PRIORITY_SOURCE_ARTICLES = ACCESS_PRIORITY_BATCHES.flatMap((batch) => batch.articles);
