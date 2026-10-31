import { spawn, type SpawnOptionsWithStdioTuple, type StdioPipe } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { articleDraftSchema } from "../lib/encyclopedia/article-draft";
import { factoryClaimsResponseSchema } from "../lib/encyclopedia/factory-research";
import { expandedArticleSchema } from "../lib/encyclopedia/generation-frame";
import {
  extractLooseJsonObject,
  hubpediaAiJobFileSchema,
  selectPendingHubpediaJobs,
  type HubpediaAiJobMode,
} from "../lib/encyclopedia/llm-batch";
import { translationResponseSchema } from "../lib/encyclopedia/translation";

/*
 * Claude CLI counterpart of run-hubpedia-ai-jobs.ts: same job file in, same
 * resumable candidate JSONL out, but generation goes through the logged-in
 * `claude -p` subscription instead of an API key. House rules for unattended
 * CLI runs apply: the model is always explicit, the prompt goes through stdin
 * (long Japanese prompts passed as arguments come back empty), sessions are
 * not persisted, and subagent tools are disallowed.
 */

function option(name: string) {
  return process.argv.find((argument) => argument.startsWith(`--${name}=`))?.slice(name.length + 3);
}

const input = option("input");
const output = option("output");
const model = option("model");
if (!input || !output || !model) {
  throw new Error("Usage: tsx scripts/run-hubpedia-claude-jobs.ts --input=jobs.json --output=candidates.jsonl --model=opus|sonnet|haiku [--limit=N]");
}
if (!/^[a-z0-9.-]+$/.test(model)) throw new Error("--model must be a plain model name such as opus or sonnet.");
/* Narrowed once here: the workers read it from inside a closure. */
const modelName: string = model;
const outputPath: string = output;
const limit = Number(option("limit") ?? "25");
if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) throw new Error("--limit must be 1 to 1000.");
/* Each job is an independent completion, so running them one at a time made
 * a batch take the sum of its parts. Kept modest by default: every job is a
 * separate CLI process against one subscription. */
const concurrency = Number(option("concurrency") ?? "3");
/* Measured 2026-08-28: each CLI worker holds 50-113 MB, so the ceiling is
 * set by the machine rather than by caution. Sixteen workers cost under
 * 2 GB, which fits alongside everything else running here. */
if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 16) {
  throw new Error("--concurrency must be an integer from 1 to 16.");
}

const jobFile = hubpediaAiJobFileSchema.parse(JSON.parse(readFileSync(resolve(input), "utf8")));
const completed = new Set<string>();
if (existsSync(resolve(output))) {
  for (const line of readFileSync(resolve(output), "utf8").split(/\r?\n/).filter(Boolean)) {
    const record = JSON.parse(line) as { slug?: unknown; status?: unknown };
    if (record.status === "candidate_review_required" && typeof record.slug === "string") completed.add(record.slug);
  }
}
const pending = selectPendingHubpediaJobs(jobFile.jobs, completed, limit);
console.log(JSON.stringify({ mode: jobFile.mode, inputJobs: jobFile.jobs.length, selectedJobs: pending.length, provider: "claude-cli", model }));

function validateResult(mode: HubpediaAiJobMode, value: unknown) {
  if (mode === "expand") return expandedArticleSchema.parse(value);
  if (mode === "extract-claims") return factoryClaimsResponseSchema.parse(value);
  if (mode === "sourced-article") return articleDraftSchema.parse(value);
  return translationResponseSchema.parse(value);
}

let succeeded = 0;
let failed = 0;
/* The API path gets JSON by response_format; a chat CLI needs to be told.
 * The second sentence matters: the request itself is JSON with task and
 * contractVersion around the payload, and without this the model mirrors
 * that envelope into its answer, which strict schemas then reject. */
const JSON_ONLY = [
  "Respond with one JSON object and nothing else: no Markdown fences, no preamble, no closing remark.",
  "Return only the object described by outputContract. Do not repeat the request's own wrapper fields such as task, contractVersion, outputContract, or input.",
].join(" ");

function runJob(prompt: string) {
  return new Promise<{ stdout: string; stderr: string; status: number | null }>((settle, reject) => {
    /* Windows resolves `claude` through its .cmd shim, so the command needs a
     * shell. Arguments stay a fixed literal list — nothing here is built from
     * job content, which is passed on stdin. */
    const options: SpawnOptionsWithStdioTuple<StdioPipe, StdioPipe, StdioPipe> = {
      shell: true,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    };
    const child = spawn("claude", [
      "-p",
      "--model", modelName,
      "--no-session-persistence",
      "--disallowedTools", "Task,Agent,Bash,Write,Edit,WebSearch,WebFetch",
      "--output-format", "text",
    ], options);
    let stdout = "";
    let stderr = "";
    /* A hung CLI must not hold the whole batch open. */
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("claude CLI timed out after 600s."));
    }, 600_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (status) => { clearTimeout(timer); settle({ stdout, stderr, status }); });
    child.stdin.end(prompt, "utf8");
  });
}

/* Workers pull from one shared cursor, so a slow job does not stall the
 * others and each result is appended as soon as it lands — a batch stopped
 * halfway still resumes from exactly what finished. */
let cursor = 0;
async function worker() {
  while (cursor < pending.length) {
    const job = pending[cursor++];
    try {
      const result = await runJob(`${job.system}\n\n${JSON_ONLY}\n\n${job.prompt}`);
      if (result.status !== 0) throw new Error(`claude CLI exited ${result.status}: ${result.stderr.slice(0, 300)}`);
      const parsed = validateResult(jobFile.mode, extractLooseJsonObject(result.stdout));
      appendFileSync(resolve(outputPath), `${JSON.stringify({
        version: 1,
        status: "candidate_review_required",
        slug: job.slug,
        locale: job.locale,
        mode: jobFile.mode,
        provider: "claude-cli",
        model: modelName,
        generatedAt: new Date().toISOString(),
        usage: null,
        output: parsed,
      })}\n`, "utf8");
      succeeded += 1;
      console.log(JSON.stringify({ slug: job.slug, status: "ok" }));
    } catch (error) {
      failed += 1;
      console.error(JSON.stringify({ slug: job.slug, status: "failed", error: error instanceof Error ? error.message.slice(0, 300) : "unknown" }));
    }
  }
}

/* tsx compiles this to CJS, where top-level await is unavailable. */
async function main() {
  await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, worker));
  console.log(JSON.stringify({ succeeded, failed, concurrency: Math.min(concurrency, pending.length) }));
  if (failed > 0) process.exitCode = 1;
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Hubpedia Claude batch failed.");
  process.exitCode = 1;
});
