const baseUrl = (process.argv[2] || process.env.HUB_SEARCH_BASE_URL || "http://127.0.0.1:3020").replace(/\/+$/, "");
const iterations = Math.max(1, Math.min(20, Number(process.env.HUB_SEARCH_ITERATIONS || 5)));
const p95LimitMs = Math.max(1, Number(process.env.HUB_SEARCH_P95_LIMIT_MS || 750));
const queries = (process.env.HUB_SEARCH_BENCHMARK_QUERIES || "AI,ニュース,ゲーム,東京,0x307e6115eddb7cA3996804E30C3396034e04cb0d")
  .split(",").map((value) => value.trim()).filter(Boolean);

function percentile(values, quantile) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)];
}

const samples = [];
for (const query of queries) {
  for (let attempt = 0; attempt < iterations; attempt += 1) {
    const startedAt = performance.now();
    const response = await fetch(`${baseUrl}/api/search?q=${encodeURIComponent(query)}`, {
      headers: { accept: "application/json" },
    });
    const durationMs = performance.now() - startedAt;
    await response.arrayBuffer();
    samples.push({ query, attempt: attempt + 1, status: response.status, durationMs });
  }
}

const durations = samples.map((sample) => sample.durationMs);
const failures = samples.filter((sample) => sample.status !== 200);
const report = {
  baseUrl,
  measuredAt: new Date().toISOString(),
  queries,
  iterations,
  samples: samples.length,
  failures: failures.length,
  p50Ms: Math.round(percentile(durations, 0.5)),
  p95Ms: Math.round(percentile(durations, 0.95)),
  maximumMs: Math.round(Math.max(0, ...durations)),
  p95LimitMs,
};
console.log(JSON.stringify(report, null, 2));
if (failures.length || report.p95Ms > p95LimitMs) process.exitCode = 1;
