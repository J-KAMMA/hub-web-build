const HUBPEDIA_CONTEXT_QUERY_LIMIT = 240;

export function hubpediaArticleHref(slug: string) {
  return `/hubpedia/${encodeURIComponent(slug.trim())}`;
}

export function hubpediaSearchHref(query: string) {
  const normalizedQuery = query.replace(/\s+/gu, " ").trim().slice(0, HUBPEDIA_CONTEXT_QUERY_LIMIT);
  if (!normalizedQuery) return "/hubpedia";

  return `/hubpedia?${new URLSearchParams({ q: normalizedQuery }).toString()}`;
}
