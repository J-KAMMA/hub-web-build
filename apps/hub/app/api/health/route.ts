import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { classifyHubReadiness, hubFeatureFlags } from "@/lib/server/hub-readiness";

/*
 * Public callers get the overall status only. Feature flags and database latency are internal
 * details (they reveal which products are switched on and how loaded the database is).
 */
function publicHealthBody(report: ReturnType<typeof classifyHubReadiness>) {
  return { status: report.status, service: report.service, checkedAt: report.checkedAt };
}
import { runHubHealthChecks } from "@/lib/platform/health";
import { createHubLogger } from "@/lib/platform/logger";
import { createHubRequestContext, hubContextHeaders } from "@/lib/platform/request-context";

export const dynamic = "force-dynamic";

const logger = createHubLogger("hub");

export async function GET(request: Request) {
  const context = createHubRequestContext(request);
  const headers = { "cache-control": "no-store", ...hubContextHeaders(context) };
  const url = new URL(request.url);
  if (url.searchParams.get("probe") === "live") {
    logger.info("health.liveness", context, { status: 200 });
    return Response.json({
      status: "alive",
      service: "hub",
      checkedAt: new Date().toISOString(),
    }, { headers });
  }

  const startedAt = performance.now();
  const database = getOptionalHubD1();
  if (!database) {
    const report = classifyHubReadiness(
      { state: "unavailable" },
      hubFeatureFlags(),
    );
    logger.warn("health.readiness", context, { status: 503, readiness: report.status });
    return Response.json(publicHealthBody(report), { status: 503, headers });
  }

  const health = await runHubHealthChecks("hub", [{
    name: "d1",
    essential: true,
    async check() {
      const result = await database.prepare("SELECT 1 AS ok").first<{ ok: number }>();
      const latencyMs = Math.max(0, Math.round(performance.now() - startedAt));
      return {
        status: result?.ok === 1
          ? latencyMs > 1_000 ? "degraded" as const : "ready" as const
          : "unavailable" as const,
        latencyMs,
      };
    },
  }]);
  const d1 = health.dependencies[0];
  const report = classifyHubReadiness(
    { state: d1?.status ?? "unavailable", latencyMs: d1?.latencyMs },
    hubFeatureFlags(),
  );
  const status = report.status === "unavailable" ? 503 : 200;
  logger[status === 200 ? "info" : "warn"]("health.readiness", context, {
    status,
    readiness: report.status,
    dependencyCount: health.dependencies.length,
  });
  return Response.json(publicHealthBody(report), { status, headers });
}
