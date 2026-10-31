export interface HubpediaSearchOverride {
  reading?: string;
  aliases?: readonly string[];
}

// Only exceptional readings and common names belong here. Generated readings
// remain the default so new articles do not require a manual entry.
export const HUBPEDIA_SEARCH_OVERRIDES: Readonly<Record<string, HubpediaSearchOverride>> = {
  "generative-ai": { reading: "せいせいえーあい", aliases: ["生成系AI", "ジェネレーティブAI", "Generative AI"] },
  "ai-core-015": { reading: "えーぴーあい", aliases: ["Application Programming Interface"] },
  "retrieval-augmented-generation": { aliases: ["RAG", "検索拡張生成"] },
  "large-language-model": { aliases: ["LLM", "大規模言語モデル"] },
};

export function getHubpediaSearchOverride(slug: string) {
  return HUBPEDIA_SEARCH_OVERRIDES[slug];
}
