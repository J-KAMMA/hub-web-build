export interface CuratedSeedSource {
  url: string;
  title: string;
  publisher: string;
  language: string;
  reliabilityTier: "primary" | "authoritative";
  license?: string;
  metadata?: Record<string, unknown>;
}

export interface CuratedSeedArticle {
  slug: string;
  canonicalName: string;
  topicType: string;
  description: string;
  title: string;
  summary: string;
  bodyMarkdown: string;
  sources: CuratedSeedSource[];
}
