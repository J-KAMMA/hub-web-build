const CACHE_NAME = "hub-web-search-v1";
const CACHE_ORIGIN = "https://web-search-cache.invalid/";

type SearchCacheEntry<T> =
  | { kind: "value"; value: T }
  | { kind: "error" };

const memoryCache = new Map<string, { entry: SearchCacheEntry<unknown>; expiresAt: number }>();
const inFlight = new Map<string, Promise<unknown>>();

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function getPlatformCache() {
  try {
    if (typeof caches === "undefined") return null;
    const cloudflareCache = (caches as CacheStorage & { default?: Cache }).default;
    return cloudflareCache ?? await caches.open(CACHE_NAME);
  } catch {
    return null;
  }
}

function cacheRequest(key: string) {
  return new Request(`${CACHE_ORIGIN}${key}`);
}

async function readEntry<T>(key: string): Promise<SearchCacheEntry<T> | null> {
  const local = memoryCache.get(key);
  if (local && local.expiresAt > Date.now()) return local.entry as SearchCacheEntry<T>;
  if (local) memoryCache.delete(key);

  const cache = await getPlatformCache();
  const response = await cache?.match(cacheRequest(key));
  if (!response) return null;
  try {
    return await response.json() as SearchCacheEntry<T>;
  } catch {
    return null;
  }
}

async function writeEntry<T>(key: string, entry: SearchCacheEntry<T>, ttlSeconds: number) {
  memoryCache.set(key, { entry, expiresAt: Date.now() + ttlSeconds * 1_000 });
  const cache = await getPlatformCache();
  if (!cache) return;
  try {
    await cache.put(cacheRequest(key), new Response(JSON.stringify(entry), {
      headers: {
        "Cache-Control": `public, max-age=${ttlSeconds}`,
        "Content-Type": "application/json",
      },
    }));
  } catch {
    // A missing or read-only Cache API must not make search unavailable.
  }
}

function waitForShared<T>(promise: Promise<T>, signal?: AbortSignal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

export async function cachedSearch<T>(
  normalizedQuery: string,
  load: () => Promise<T>,
  options: { successTtlSeconds: number; emptyTtlSeconds: number; errorTtlSeconds: number; isEmpty: (value: T) => boolean },
  signal?: AbortSignal,
) {
  // Only a digest is used as a cache/in-flight key; query text is never persisted as metadata.
  const key = await sha256(normalizedQuery);
  const cached = await readEntry<T>(key);
  if (cached?.kind === "value") return cached.value;
  if (cached?.kind === "error") throw new Error("Web search provider unavailable");

  let shared = inFlight.get(key) as Promise<T> | undefined;
  if (!shared) {
    shared = (async () => {
      try {
        const value = await load();
        await writeEntry(key, { kind: "value", value }, options.isEmpty(value) ? options.emptyTtlSeconds : options.successTtlSeconds);
        return value;
      } catch (error) {
        await writeEntry(key, { kind: "error" }, options.errorTtlSeconds);
        throw error;
      } finally {
        inFlight.delete(key);
      }
    })();
    inFlight.set(key, shared);
  }
  return waitForShared(shared, signal);
}

export function resetWebSearchCacheForTests() {
  memoryCache.clear();
  inFlight.clear();
}
