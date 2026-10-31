/* Hub installed-app service worker.
 * Security boundary: never cache pages, API responses, media bodies, or user data.
 */
const STATIC_CACHE = "hub-static-v3";
const DEVELOPMENT_HOSTS = new Set(["127.0.0.1", "localhost"]);
const developmentScope = DEVELOPMENT_HOSTS.has(self.location.hostname);

self.addEventListener("install", (event) => {
  if (developmentScope) event.waitUntil(self.skipWaiting());
});
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") void self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("hub-static-") && key !== STATIC_CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()),
  );
});

function isCacheableStatic(request, url) {
  if (request.method !== "GET" || url.origin !== self.location.origin) return false;
  if (url.pathname.startsWith("/api/") || url.pathname.includes("/api/")) return false;
  if (url.pathname.startsWith("/vault/") || url.pathname.startsWith("/music/api/") || url.pathname.startsWith("/ai/api/")) return false;
  return url.pathname.startsWith("/_next/static/") || url.pathname === "/icon.svg" || url.pathname === "/icon-maskable.svg";
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // Next development assets use stable URLs. Caching them would keep an old
  // interface after source changes and make device verification misleading.
  if (developmentScope) return;
  if (!isCacheableStatic(event.request, url)) return;

  event.respondWith(
    caches.open(STATIC_CACHE).then(async (cache) => {
      const cached = await cache.match(event.request);
      const network = fetch(event.request).then((response) => {
        if (response.ok && response.type === "basic" && !response.headers.has("set-cookie")) void cache.put(event.request, response.clone());
        return response;
      });
      return cached ?? network;
    }),
  );
});
