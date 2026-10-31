const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

export function productionSmokeBaseUrl(value) {
  const url = new URL(value);
  const loopback = url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
  if (url.protocol !== "https:" && !loopback)
    throw new Error("production smoke origin must use HTTPS or loopback HTTP");
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/")
    throw new Error("production smoke origin must not contain credentials, path, query or fragment");
  return url;
}

function cacheDisabled(response) {
  return (response.headers.get("cache-control") ?? "")
    .toLowerCase()
    .split(",")
    .some((value) => value.trim() === "no-store");
}

async function json(response) {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json"))
    throw new Error("response is not JSON");
  return response.json();
}

export async function runProductionReadonlySmoke({ baseUrl, fetcher = fetch, timeoutMs = 5_000 }) {
  const origin = productionSmokeBaseUrl(baseUrl);
  const checks = [];

  async function check(name, path, validate) {
    const startedAt = performance.now();
    try {
      const response = await fetcher(new URL(path, origin), {
        method: "GET",
        redirect: "error",
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      await validate(response);
      checks.push({ name, healthy: true, status: response.status, latencyMs: Math.round(performance.now() - startedAt) });
    } catch (error) {
      checks.push({
        name,
        healthy: false,
        status: 0,
        latencyMs: Math.round(performance.now() - startedAt),
        error: error instanceof Error ? error.message : "unknown error",
      });
    }
  }

  await check("liveness", "/api/health?probe=live", async (response) => {
    if (response.status !== 200 || !cacheDisabled(response)) throw new Error("liveness contract failed");
    const body = await json(response);
    if (body?.status !== "alive" || body?.service !== "hub") throw new Error("liveness payload failed");
  });

  await check("readiness", "/api/health", async (response) => {
    if (response.status !== 200 || !cacheDisabled(response)) throw new Error("readiness contract failed");
    const body = await json(response);
    // /api/health returns the overall status only; flags and database detail are not public.
    if (body?.status !== "ready" || body?.service !== "hub") throw new Error("readiness failed");
    if (body?.features !== undefined || body?.dependencies !== undefined) throw new Error("health exposes internal detail");
  });

  await check("maintenance", "/", async (response) => {
    if (response.status !== 503 || response.headers.get("retry-after") !== "300" || !cacheDisabled(response))
      throw new Error("maintenance response contract failed");
    const body = await json(response);
    if (body?.retryable !== true) throw new Error("maintenance payload is not retryable");
  });

  await check("non-core-gate", "/wallet", async (response) => {
    if (response.status !== 404 || !cacheDisabled(response)) throw new Error("non-core release gate failed");
    const body = await json(response);
    if (typeof body?.error !== "string" || body.error.length === 0) throw new Error("non-core response payload failed");
  });

  await check("admin-boundary", "/api/admin/platform/services", async (response) => {
    if (![401, 403].includes(response.status) || !cacheDisabled(response))
      throw new Error("anonymous admin boundary failed");
    const body = await json(response);
    const category = body?.error?.category;
    if (category !== "unauthenticated" && category !== "forbidden")
      throw new Error("anonymous admin response payload failed");
  });

  return {
    format: "jkamma-hub-production-readonly-smoke-v1",
    healthy: checks.every((check) => check.healthy),
    checkedAt: new Date().toISOString(),
    origin: origin.origin,
    checks,
  };
}
