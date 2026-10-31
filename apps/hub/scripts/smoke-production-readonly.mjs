import { runProductionReadonlySmoke } from "./production-readonly-smoke-lib.mjs";

const baseUrl = String(process.env.HUB_PRODUCTION_SMOKE_BASE_URL ?? "").trim();
if (!baseUrl) throw new Error("HUB_PRODUCTION_SMOKE_BASE_URL is required");

const timeoutMs = Number(process.env.HUB_PRODUCTION_SMOKE_TIMEOUT_MS ?? 5_000);
if (!Number.isFinite(timeoutMs) || timeoutMs < 500 || timeoutMs > 30_000)
  throw new Error("HUB_PRODUCTION_SMOKE_TIMEOUT_MS must be between 500 and 30000");

const report = await runProductionReadonlySmoke({ baseUrl, timeoutMs });
console.log(JSON.stringify(report));
if (!report.healthy) process.exitCode = 1;
