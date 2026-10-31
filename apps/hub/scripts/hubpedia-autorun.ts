import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/*
 * Drains a queue of topic specs without supervision: build a plan, run the
 * research factory, record what came out, move the spec aside, take the next.
 *
 * The queue is the boundary. A spec names topics and candidate URLs; the plan
 * builder decides which of those the publisher terms and extraction actually
 * allow, and the factory's own gates decide what reaches the catalog. Nothing
 * here can widen those gates, so an unattended run can produce fewer articles
 * than hoped but not worse ones.
 *
 * Each spec is attempted once. A spec that fails goes to failed/ with its
 * error rather than being retried, because the failures seen in practice —
 * a source that 404s, a topic whose second source says nothing about the
 * subject — are not fixed by running the same thing again.
 */

const scriptDir = dirname(fileURLToPath(import.meta.url));
const hubDir = resolve(scriptDir, "..");
const require = createRequire(import.meta.url);

function option(name: string) {
  return process.argv.find((argument) => argument.startsWith(`--${name}=`))?.slice(name.length + 3);
}

const queueDir = resolve(option("queue") ?? join(hubDir, "data", "factory", "specs", "queue"));
const doneDir = join(dirname(queueDir), "done");
const failedDir = join(dirname(queueDir), "failed");
const provider = option("provider") ?? "claude";
/* Writing defaults to sonnet, not opus. Lanes call the same subscription the
 * interactive session does, and several lanes writing in parallel dominate the
 * budget. Pass --model=opus for a wave whose prose is worth the difference. */
const model = option("model") ?? "sonnet";
const extractModel = option("extract-model") ?? "sonnet";
/* Extraction can run on another provider entirely; it is the only stage whose
 * output is machine-checked against the source, so a weaker model there costs
 * claims rather than truth. Passed straight through to the factory. */
const extractProvider = option("extract-provider") ?? provider;
const codexModel = option("codex-model");
const codexConcurrency = option("codex-concurrency");
const apiModel = option("api-model");
const apiExtractModel = option("extract-api-model");
const concurrency = Number(option("concurrency") ?? "4");
if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 16) {
  throw new Error("--concurrency must be an integer from 1 to 16.");
}
const maxSpecs = Number(option("max") ?? "50");
if (!Number.isSafeInteger(maxSpecs) || maxSpecs < 1) throw new Error("--max must be a positive integer.");

for (const directory of [queueDir, doneDir, failedDir]) mkdirSync(directory, { recursive: true });

function run(script: string, args: string[]) {
  const result = spawnSync(process.execPath, [require.resolve("tsx/cli"), script, ...args], {
    cwd: hubDir,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  process.stdout.write(result.stdout ?? "");
  if (result.status !== 0) process.stderr.write(result.stderr ?? "");
  return { exitCode: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function batchNameFor(specFile: string) {
  /* Batch names index run directories and seed file names, so they must be
   * slug-shaped and stable for the same spec — a rerun then resumes rather
   * than starting a second pile of candidates. */
  return specFile.replace(/\.json$/i, "").toLowerCase().replace(/[^a-z0-9-]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 60);
}

const specFiles = readdirSync(queueDir).filter((name) => name.toLowerCase().endsWith(".json")).sort().slice(0, maxSpecs);
console.log(JSON.stringify({ stage: "autorun-start", queue: queueDir, specs: specFiles.length, provider, model, extractProvider, extractModel, concurrency }));

const summary: Array<Record<string, unknown>> = [];
for (const specFile of specFiles) {
  const batch = batchNameFor(specFile);
  const specPath = join(queueDir, specFile);
  const planPath = join(hubDir, "data", "factory", "plans", `${batch}.plan.json`);
  console.log(JSON.stringify({ stage: "spec-start", spec: specFile, batch }));

  const planned = run("scripts/hubpedia-plan-builder.ts", [`--spec=${specPath}`, `--output=${planPath}`]);
  if (planned.exitCode !== 0) {
    renameSync(specPath, join(failedDir, specFile));
    summary.push({ spec: specFile, stage: "plan", ok: false, error: planned.stderr.trim().slice(0, 200) });
    continue;
  }

  const produced = run("scripts/hubpedia-factory.ts", [
    "--mode=research",
    `--plan=${planPath}`,
    `--batch=${batch}`,
    `--provider=${provider}`,
    `--model=${model}`,
    `--extract-model=${extractModel}`,
    `--extract-provider=${extractProvider}`,
    ...(codexModel ? [`--codex-model=${codexModel}`] : []),
    ...(codexConcurrency ? [`--codex-concurrency=${codexConcurrency}`] : []),
    ...(apiModel ? [`--api-model=${apiModel}`] : []),
    ...(apiExtractModel ? [`--extract-api-model=${apiExtractModel}`] : []),
    `--concurrency=${concurrency}`,
  ]);

  const reportPath = join(hubDir, "data", "factory", batch, "report.json");
  let passed: string[] = [];
  let failed: unknown[] = [];
  let packagedFile: string | null = null;
  if (existsSync(reportPath)) {
    const report = JSON.parse(readFileSync(reportPath, "utf8")) as { passed?: string[]; failed?: unknown[]; packagedFile?: string | null };
    passed = report.passed ?? [];
    failed = report.failed ?? [];
    packagedFile = report.packagedFile ?? null;
  }
  /* Whether the batch reached the catalog is the only thing that decides where
   * the spec goes, and packagedFile is the record of that.
   *
   * The exit code is not: the factory returns non-zero when any generation job
   * needed a retry, so a batch that packaged fourteen articles was being filed
   * as a failure and its spec parked in failed/ for a rerun that would only
   * duplicate work. A batch where every topic was stopped by a gate packages
   * nothing, and that is a spec problem which still belongs in failed/. */
  const ok = passed.length > 0 && packagedFile !== null;
  renameSync(specPath, join(ok ? doneDir : failedDir, specFile));
  summary.push({ spec: specFile, batch, ok, passed, failedTopics: failed.length, packagedFile });
  console.log(JSON.stringify({ stage: "spec-done", spec: specFile, ok, passed: passed.length, packagedFile }));
}

const report = {
  stage: "autorun-report",
  finishedAt: new Date().toISOString(),
  specs: summary.length,
  articles: summary.reduce((total, entry) => total + ((entry.passed as string[] | undefined)?.length ?? 0), 0),
  results: summary,
  publication: "Reader layer only. Publication approval stays manual in publication-manifest.ts.",
};
mkdirSync(join(hubDir, "data", "factory"), { recursive: true });
writeFileSync(join(hubDir, "data", "factory", "autorun-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
