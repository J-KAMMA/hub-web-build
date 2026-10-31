export const HUBPEDIA_ARTICLE_ALIASES: Readonly<Record<string, string>> = {
  "ai-core-010": "internet",
  "ai-core-041": "generative-ai",
  "ai-core-053": "retrieval-augmented-generation",
  "ai-core-074": "blockchain",
  "ai-core-090": "space-development",
  "s2-0113": "web-browser",
  "s2-0366": "ai-core-046",
  "s2-0421": "renewable-energy",
  "s2-0492": "copyright",
  "s2-0502": "information-literacy",
  "free-will": "s2-0526",
  "causality": "s2-0536",
  "self": "s2-0524",
  "fifa-world-cup": "s5-0053",
  "michael-jackson": "s5-0073",
  /* Merged articles. Each pair had been written from the same two pages and
   * repeated whole sections of each other — the SI system and the constants
   * that define it, confirmed cases and the testing that produces them,
   * emissions in total and the same emissions per head. Merging removes an
   * address, so the address is pointed at the article that absorbed it and
   * existing links keep working. */
  "defining-constants": "international-system-of-units",
  "covid-testing": "covid-cases",
  "per-capita-co2": "annual-co2",
};

export function canonicalHubpediaSlug(slug: string) {
  return HUBPEDIA_ARTICLE_ALIASES[slug] ?? slug;
}

export function canonicalizeHubpediaLinks(markdown: string) {
  return markdown.replace(/\]\(\/hubpedia\/([a-z0-9]+(?:-[a-z0-9]+)*)\)/g, (source, slug: string) => {
    const canonical = canonicalHubpediaSlug(slug);
    return canonical === slug ? source : `](/hubpedia/${canonical})`;
  });
}
