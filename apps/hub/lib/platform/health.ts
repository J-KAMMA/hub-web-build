export type HubHealthCheck = {
  name: string;
  essential: boolean;
  check: () => Promise<{ status: "ready" | "degraded" | "unavailable"; latencyMs?: number }>;
};

export async function runHubHealthChecks(service: string, checks: readonly HubHealthCheck[]) {
  const results = await Promise.all(checks.map(async (check) => {
    const startedAt = performance.now();
    try {
      const result = await check.check();
      return { name: check.name, essential: check.essential, ...result, latencyMs: result.latencyMs ?? Math.round(performance.now() - startedAt) };
    } catch {
      return { name: check.name, essential: check.essential, status: "unavailable" as const, latencyMs: Math.round(performance.now() - startedAt) };
    }
  }));
  const status = results.some((result) => result.essential && result.status === "unavailable") ? "unavailable"
    : results.some((result) => result.status !== "ready") ? "degraded" : "ready";
  return { status, service, checkedAt: new Date().toISOString(), dependencies: results };
}
