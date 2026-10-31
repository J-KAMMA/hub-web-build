import { spawn, type SpawnOptionsWithStdioTuple, type StdioPipe } from "node:child_process";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

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
 * Codex CLI counterpart of run-hubpedia-claude-jobs.ts: same job file in, same
 * resumable candidate JSONL out, generation through the logged-in `codex exec`
 * subscription. A second writer is worth having because the gates are written
 * down — a draft has to parse as the contract, cite only verified claims, and
 * pass the sourced audit, whoever wrote it — so switching writers changes cost
 * and prose, never the standard.
 *
 * Three differences from the Claude path, all forced by the tool:
 *
 *   `codex exec` is an agent, not a completion endpoint. It is given the
 *   read-only sandbox so a generation job cannot touch the tree; nothing here
 *   asks it to edit anything.
 *
 *   Its answer is taken from --output-last-message rather than stdout, which
 *   carries progress lines the parser would have to sift.
 *
 *   Sessions are not persisted (--ephemeral). A batch of hundreds would
 *   otherwise leave hundreds of resumable threads behind.
 */

function option(name: string) {
  return process.argv.find((argument) => argument.startsWith(`--${name}=`))?.slice(name.length + 3);
}

const input = option("input");
const output = option("output");
const model = option("model");
if (!input || !output) {
  throw new Error("Usage: tsx scripts/run-hubpedia-codex-jobs.ts --input=jobs.json --output=candidates.jsonl [--model=name] [--limit=N] [--concurrency=N]");
}
if (model && !/^[a-z0-9.\-]+$/i.test(model)) throw new Error("--model must be a plain model name.");
const modelName = model ?? null;
const outputPath: string = output;
const limit = Number(option("limit") ?? "25");
if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) throw new Error("--limit must be 1 to 1000.");
/* Lower than the Claude default on purpose: each worker is a full agent
 * session, which costs more memory and more of the same subscription than a
 * single completion does. */
const concurrency = Number(option("concurrency") ?? "2");
if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 8) {
  throw new Error("--concurrency must be an integer from 1 to 8.");
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
console.log(JSON.stringify({ mode: jobFile.mode, inputJobs: jobFile.jobs.length, selectedJobs: pending.length, provider: "codex-cli", model: modelName }));

function validateResult(mode: HubpediaAiJobMode, value: unknown) {
  if (mode === "expand") return expandedArticleSchema.parse(value);
  if (mode === "extract-claims") return factoryClaimsResponseSchema.parse(value);
  if (mode === "sourced-article") return articleDraftSchema.parse(value);
  return translationResponseSchema.parse(value);
}

/* Same instruction the Claude path needs, and for the same reason: the request
 * is itself JSON wrapping the payload, and without this the answer comes back
 * with the wrapper mirrored into it. */
const JSON_ONLY = [
  "Respond with one JSON object and nothing else: no Markdown fences, no preamble, no closing remark.",
  "Return only the object described by outputContract. Do not repeat the request's own wrapper fields such as task, contractVersion, outputContract, or input.",
  "Do not read or write any file, and do not run any command. Everything needed is in this message.",
].join(" ");

function runJob(prompt: string, answerPath: string) {
  return new Promise<{ stderr: string; status: number | null }>((settle, reject) => {
    /* Windows resolves `codex` through a shim, so the command needs a shell.
     * Arguments stay a fixed literal list — nothing is built from job content,
     * which goes in on stdin. Long Japanese prompts passed as arguments come
     * back empty on this platform. */
    const options: SpawnOptionsWithStdioTuple<StdioPipe, StdioPipe, StdioPipe> = {
      shell: true,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    };
    const child = spawn("codex", [
      "exec",
      ...(modelName ? ["--model", modelName] : []),
      "--sandbox", "read-only",
      "--ephemeral",
      "--skip-git-repo-check",
      "--color", "never",
      "--output-last-message", JSON.stringify(answerPath),
      "-",
    ], options);
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("codex CLI timed out after 900s."));
    }, 900_000);
    child.stdout.resume();
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (status) => { clearTimeout(timer); settle({ stderr, status }); });
    child.stdin.end(prompt, "utf8");
  });
}

let succeeded = 0;
let failed = 0;
let cursor = 0;

async function worker(scratch: string, index: number) {
  const answerPath = join(scratch, `answer-${index}.txt`);
  while (cursor < pending.length) {
    const job = pending[cursor++];
    try {
      rmSync(answerPath, { force: true });
      const result = await runJob(`${job.system}\n\n${JSON_ONLY}\n\n${job.prompt}`, answerPath);
      if (result.status !== 0) throw new Error(`codex CLI exited ${result.status}: ${result.stderr.slice(0, 300)}`);
      if (!existsSync(answerPath)) throw new Error("codex CLI wrote no final message.");
      const parsed = validateResult(jobFile.mode, extractLooseJsonObject(readFileSync(answerPath, "utf8")));
      appendFileSync(resolve(outputPath), `${JSON.stringify({
        version: 1,
        status: "candidate_review_required",
        slug: job.slug,
        locale: job.locale,
        mode: jobFile.mode,
        provider: "codex-cli",
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
  const scratch = mkdtempSync(join(tmpdir(), "hubpedia-codex-"));
  try {
    const workers = Math.min(concurrency, pending.length);
    await Promise.all(Array.from({ length: workers }, (_unused, index) => worker(scratch, index)));
    console.log(JSON.stringify({ succeeded, failed, concurrency: workers }));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  if (failed > 0) process.exitCode = 1;
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Hubpedia Codex batch failed.");
  process.exitCode = 1;
});
