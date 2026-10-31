import "server-only";

import { cachedSearch } from "./web-search-cache";

const BRAVE_SEARCH_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";
const RESULT_LIMIT = 10;

export type HubWebSearchResult = {
  title: string;
  url: string;
  description: string;
  age?: string;
};

type BraveWebResponse = {
  web?: {
    results?: Array<{
      title?: unknown;
      url?: unknown;
      description?: unknown;
      age?: unknown;
    }>;
  };
};

function safePublicUrl(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export async function searchPublicWeb(query: string, signal?: AbortSignal) {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY?.trim();
  if (!apiKey) return { configured: false, results: [] as HubWebSearchResult[] };

  return cachedSearch(query, async () => {

  const endpoint = new URL(BRAVE_SEARCH_ENDPOINT);
  endpoint.searchParams.set("q", query);
  endpoint.searchParams.set("count", String(RESULT_LIMIT));
  endpoint.searchParams.set("search_lang", "ja");
  endpoint.searchParams.set("safesearch", "moderate");

  const response = await fetch(endpoint, {
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": apiKey,
    },
  });
  if (!response.ok) throw new Error("Web search provider unavailable");

  const payload = await response.json() as BraveWebResponse;
  const results = (payload.web?.results ?? []).flatMap((item) => {
    const url = safePublicUrl(item.url);
    if (!url || typeof item.title !== "string") return [];
    return [{
      title: item.title.trim(),
      url,
      description: typeof item.description === "string" ? item.description.trim() : "",
      age: typeof item.age === "string" ? item.age : undefined,
    }];
  }).slice(0, RESULT_LIMIT);

    return { configured: true, results };
  }, {
    successTtlSeconds: 15 * 60,
    emptyTtlSeconds: 60,
    errorTtlSeconds: 30,
    isEmpty: (value) => value.results.length === 0,
  }, signal);
}
