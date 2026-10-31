const timeoutMs = Number(process.env.HUB_DEPENDENCY_TIMEOUT_MS ?? 5000);
const configured = String(process.env.HUB_OPERATIONAL_DEPENDENCIES ?? "").trim();

function parseDependency(value) {
  const separator = value.indexOf("=");
  if (separator < 1) return null;
  const name = value.slice(0, separator).trim();
  const rawUrl = value.slice(separator + 1).trim();
  if (!/^[a-z0-9][a-z0-9_-]{0,39}$/i.test(name)) return null;
  try {
    const url = new URL(rawUrl);
    const loopback = url.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
    if (url.protocol !== "https:" && !loopback) return null;
    if (url.username || url.password || url.search || url.hash) return null;
    return { name, url };
  } catch {
    return null;
  }
}

const dependencies = configured
  ? configured.split(",").map(parseDependency).filter(Boolean)
  : [];

const checks = await Promise.all(dependencies.map(async ({ name, url }) => {
  const startedAt = performance.now();
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: "application/json" },
    });
    return {
      name,
      healthy: response.ok,
      status: response.status,
      latencyMs: Math.round(performance.now() - startedAt),
    };
  } catch {
    return {
      name,
      healthy: false,
      status: 0,
      latencyMs: Math.round(performance.now() - startedAt),
    };
  }
}));

const invalidCount = configured
  ? configured.split(",").length - dependencies.length
  : 0;
const unhealthy = checks.filter((check) => !check.healthy).map((check) => check.name);
const report = {
  healthy: invalidCount === 0 && unhealthy.length === 0,
  configured: dependencies.length,
  invalidCount,
  checkedAt: new Date().toISOString(),
  checks,
  unhealthy,
};

console.log(JSON.stringify(report));
if (!report.healthy) process.exitCode = 1;
