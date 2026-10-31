export const PUBLIC_API_CACHE_POLICIES = {
  "games.catalog": { browserSeconds: 30, edgeSeconds: 300, staleSeconds: 600 },
  "videos.catalog": { browserSeconds: 15, edgeSeconds: 60, staleSeconds: 300 },
  "videos.distributed": { browserSeconds: 15, edgeSeconds: 60, staleSeconds: 300 },
  "videos.index-export": { browserSeconds: 30, edgeSeconds: 120, staleSeconds: 600 },
  "distributed.resources": { browserSeconds: 15, edgeSeconds: 60, staleSeconds: 300 },
  "shopping.reviews": { browserSeconds: 15, edgeSeconds: 60, staleSeconds: 300 },
  "hubpedia.article": { browserSeconds: 60, edgeSeconds: 300, staleSeconds: 3600 },
  "hubpedia.category": { browserSeconds: 60, edgeSeconds: 300, staleSeconds: 3600 },
  "hubpedia.search": { browserSeconds: 30, edgeSeconds: 60, staleSeconds: 300 },
  "hubpedia.retrieve": { browserSeconds: 30, edgeSeconds: 120, staleSeconds: 300 },
  /*
   * The catalogue is written by cron, not by visitors, so an edge entry that
   * lags five minutes is never wrong for long. It also stands in front of the
   * meaning search: an identical question inside the window is answered from
   * the edge, without embedding the words again or reading a single D1 row.
   */
  "music.catalog": { browserSeconds: 30, edgeSeconds: 300, staleSeconds: 900 },
} as const;

export type PublicApiCacheRoute = keyof typeof PUBLIC_API_CACHE_POLICIES;

type CacheRequestLike = { method: string; url: string; headers: { get(name: string): string | null } };

export function hasPrivateRequestState(request: CacheRequestLike) {
  return Boolean(
    request.headers.get("authorization") ||
      request.headers.get("cookie") ||
      request.headers.get("x-hub-session") ||
      request.headers.get("x-payment") ||
      request.headers.get("x-payment-authorization"),
  );
}

const PUBLIC_API_PATHS = [
  /^\/api\/games$/u,
  /^\/api\/videos$/u,
  /^\/api\/videos\/distributed$/u,
  /^\/api\/videos\/index-export$/u,
  /^\/api\/distributed\/resources$/u,
  /^\/api\/shopping\/products\/[^/]+\/reviews$/u,
  /^\/api\/hubpedia\/v1\/search$/u,
  /^\/api\/hubpedia\/retrieve$/u,
  /^\/api\/hubpedia\/v1\/articles\/[^/]+$/u,
  /^\/api\/hubpedia\/v1\/categories$/u,
  /^\/api\/hubpedia\/v1\/categories\/compare$/u,
  /^\/api\/profile\/avatar\/image\/[^/]+\/[^/]+$/u,
  /^\/api\/communities\/[^/]+\/image\/[^/]+$/u,
  /^\/api\/games\/[^/]+\/image\/[^/]+$/u,
] as const;

export function isPublicApiCacheCandidate(request: CacheRequestLike) {
  if (request.method !== "GET" || hasPrivateRequestState(request)) return false;
  const { pathname } = new URL(request.url);
  return PUBLIC_API_PATHS.some((pattern) => pattern.test(pathname));
}

export function isPublicApiCacheableResponse(response: Response) {
  const directive = response.headers.get("cache-control")?.toLowerCase() ?? "";
  return response.status === 200 && directive.includes("public") && !directive.includes("no-store") && !response.headers.has("set-cookie");
}

/**
 * Equivalent public requests share one edge entry regardless of query-string
 * ordering. Private headers are deliberately omitted because those requests
 * never reach this function.
 */
export function publicApiCacheKey(request: CacheRequestLike): Request {
  const url = new URL(request.url);
  url.hash = "";
  url.searchParams.sort();
  return new Request(url.toString(), { method: "GET" });
}

/**
 * Cache headers for the small, reviewed public API allowlist above. A request
 * carrying any identity or payment state always fails closed to no-store.
 */
export function publicApiCacheHeaders(request: CacheRequestLike, route: PublicApiCacheRoute) {
  if (request.method !== "GET" || hasPrivateRequestState(request)) {
    return { "cache-control": "private, no-store", vary: "Cookie, Authorization" };
  }
  const policy = PUBLIC_API_CACHE_POLICIES[route];
  return {
    "cache-control": `public, max-age=${policy.browserSeconds}, s-maxage=${policy.edgeSeconds}, stale-while-revalidate=${policy.staleSeconds}`,
    vary: "Accept-Encoding",
  };
}
