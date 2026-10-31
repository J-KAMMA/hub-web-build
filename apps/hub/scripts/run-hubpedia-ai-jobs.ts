import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { articleDraftSchema } from "../lib/encyclopedia/article-draft";
import { factoryClaimsResponseSchema } from "../lib/encyclopedia/factory-research";
import { expandedArticleSchema } from "../lib/encyclopedia/generation-frame";
import {
  extractJsonObject,
  hubpediaAiJobFileSchema,
  selectPendingHubpediaJobs,
  type HubpediaAiJob,
  type HubpediaAiJobMode,
} from "../lib/encyclopedia/llm-batch";
import { ProviderStopError, requestCompletion, type BudgetConfig } from "../lib/encyclopedia/budgeted-request";
import { ChainExhaustedError, commandCodeAdapter, completeViaChain, opencodeFreeAdapter, opencodeGoAdapter } from "../lib/encyclopedia/provider-chain";
import {
  OPENCODE_GO_BASE_URL,
  OPENCODE_GO_DEFAULT_DAILY_CALLS,
  OPENCODE_GO_DEFAULT_DAILY_TOKENS,
  OPENCODE_GO_MODEL,
  positiveEnvInteger,
} from "../lib/encyclopedia/provider-quota";
import { translationResponseSchema } from "../lib/encyclopedia/translation";

/* OpenCode Go refuses requests without a session id ("MissingSessionID"); one random id per process. */
const openCodeSession = randomUUID();
const scriptDir = dirname(fileURLToPath(import.meta.url));

type CliOptions = {
  input: string;
  output: string;
  baseUrl: string;
  model: string;
  provider: string;
  limit: number;
  concurrency: number;
  rpm: number;
  maxTokens: number;
  dryRun: boolean;
  /** Present only for providers with a shared quota (opencode-go). */
  budget?: BudgetConfig;
};

function option(name: string) {
  return process.argv.find((argument) => argument.startsWith(`--${name}=`))?.slice(name.length + 3);
}

function positiveInteger(name: string, fallback: number, maximum: number) {
  const raw = option(name);
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`--${name} must be an integer from 1 to ${maximum}.`);
  }
  return value;
}

function parseOptions(): CliOptions {
  const input = option("input");
  const output = option("output");
  if (!input || !output) {
    throw new Error("Usage: tsx scripts/run-hubpedia-ai-jobs.ts --input=jobs.json --output=candidates.jsonl [--limit=5] [--dry-run]");
  }
  const provider = option("provider") ?? process.env.HUBPEDIA_LLM_PROVIDER ?? "deepseek";
  const openCodeGo = provider === "opencode-go";
  return {
    input: resolve(input),
    output: resolve(output),
    baseUrl: (option("base-url") ?? (openCodeGo ? OPENCODE_GO_BASE_URL : process.env.HUBPEDIA_LLM_BASE_URL) ?? "https://api.deepseek.com").replace(/\/$/, ""),
    model: option("model") ?? (openCodeGo ? OPENCODE_GO_MODEL : process.env.HUBPEDIA_LLM_MODEL) ?? "deepseek-v4-flash",
    provider,
    budget: openCodeGo ? {
      usagePath: resolve(scriptDir, "..", "data", "factory", ".opencode-go-usage.json"),
      caps: {
        calls: positiveEnvInteger(process.env.HUBPEDIA_OPENCODE_DAILY_CALLS, OPENCODE_GO_DEFAULT_DAILY_CALLS),
        tokens: positiveEnvInteger(process.env.HUBPEDIA_OPENCODE_DAILY_TOKENS, OPENCODE_GO_DEFAULT_DAILY_TOKENS),
      },
    } : undefined,
    limit: positiveInteger("limit", 5, 1_000),
    concurrency: positiveInteger("concurrency", 2, 8),
    rpm: positiveInteger("rpm", 20, 600),
    maxTokens: positiveInteger("max-tokens", 4_096, 32_768),
    dryRun: process.argv.includes("--dry-run"),
  };
}

function completedSlugs(path: string) {
  if (!existsSync(path)) return new Set<string>();
  const completed = new Set<string>();
  for (const line of readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean)) {
    try {
      const record = JSON.parse(line) as { slug?: unknown; status?: unknown };
      if (record.status === "candidate_review_required" && typeof record.slug === "string") completed.add(record.slug);
    } catch {
      throw new Error(`Output contains invalid JSONL and cannot be resumed safely: ${path}`);
    }
  }
  return completed;
}

function validateResult(mode: HubpediaAiJobMode, value: unknown) {
  if (mode === "expand") return expandedArticleSchema.parse(value);
  if (mode === "extract-claims") return factoryClaimsResponseSchema.parse(value);
  if (mode === "sourced-article") return articleDraftSchema.parse(value);
  return translationResponseSchema.parse(value);
}

const sleep = (milliseconds: number) => new Promise<void>((resolvePromise) => setTimeout(resolvePromise, milliseconds));

const chainStatePath = resolve(scriptDir, "..", "data", "factory", ".hubpedia-provider-state.json");
const chainAdapters = [opencodeFreeAdapter(), commandCodeAdapter(), opencodeGoAdapter()];

async function requestCandidate(options: CliOptions, job: HubpediaAiJob, mode: HubpediaAiJobMode, apiKey: string) {
  if (options.provider === "chain") {
    try {
      const served = await completeViaChain(
        { system: job.system, prompt: job.prompt, maxTokens: options.maxTokens },
        { statePath: chainStatePath, adapters: chainAdapters },
      );
      return { output: validateResult(mode, served.output), usage: { total_tokens: served.tokens }, servedBy: served.servedBy as string };
    } catch (error) {
      if (error instanceof ChainExhaustedError) {
        throw new ProviderStopError("provider_usage_limit", error.nextAvailableAt
          ? `All providers paused or exhausted; next window opens at ${new Date(error.nextAvailableAt).toISOString()}.`
          : "All providers exhausted for today.");
      }
      throw error;
    }
  }
  const result = await requestCompletion({
    baseUrl: options.baseUrl,
    apiKey,
    model: options.model,
    system: job.system,
    prompt: job.prompt,
    maxTokens: options.maxTokens,
    budget: options.budget,
    extraHeaders: options.provider === "opencode-go" ? { "x-opencode-session": openCodeSession } : undefined,
    extraBody: options.provider === "opencode-go" ? { reasoning_effort: "low" } : undefined,
    sleepImpl: sleep,
  });
  return { output: validateResult(mode, result.output), usage: result.usage, servedBy: options.provider };
}

async function main() {
  const options = parseOptions();
  const jobFile = hubpediaAiJobFileSchema.parse(JSON.parse(readFileSync(options.input, "utf8")));
  const pending = selectPendingHubpediaJobs(jobFile.jobs, completedSlugs(options.output), options.limit);
  const summary = {
    mode: jobFile.mode,
    inputJobs: jobFile.jobs.length,
    selectedJobs: pending.length,
    provider: options.provider,
    model: options.model,
    baseUrlOrigin: new URL(options.baseUrl).origin,
    output: options.output,
    dryRun: options.dryRun,
  };
  if (options.dryRun || pending.length === 0) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  /* The OpenCode Go key is read only from OPENCODE_API_KEY and is never printed or written. */
  const apiKey = options.provider === "chain" ? "chain" : options.provider === "opencode-go"
    ? process.env.OPENCODE_API_KEY
    : process.env.HUBPEDIA_LLM_API_KEY ?? process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error(options.provider === "opencode-go"
      ? "Set OPENCODE_API_KEY in the process environment."
      : "Set HUBPEDIA_LLM_API_KEY (preferred) or DEEPSEEK_API_KEY in the process environment.");
  }

  let cursor = 0;
  let succeeded = 0;
  let failed = 0;
  let stopped: string | null = null;
  const minimumInterval = Math.ceil(60_000 / options.rpm);
  let nextRequestAt = 0;
  const takeRateSlot = async () => {
    const wait = Math.max(0, nextRequestAt - Date.now());
    nextRequestAt = Math.max(Date.now(), nextRequestAt) + minimumInterval;
    if (wait) await sleep(wait);
  };
  const worker = async () => {
    while (cursor < pending.length && stopped === null) {
      const job = pending[cursor++];
      await takeRateSlot();
      try {
        const result = await requestCandidate(options, job, jobFile.mode, apiKey);
        appendFileSync(options.output, `${JSON.stringify({
          version: 1,
          status: "candidate_review_required",
          slug: job.slug,
          locale: job.locale,
          mode: jobFile.mode,
          provider: result.servedBy,
          model: options.provider === "chain" ? result.servedBy : options.model,
          generatedAt: new Date().toISOString(),
          usage: result.usage,
          output: result.output,
        })}\n`, "utf8");
        succeeded += 1;
      } catch (error) {
        if (error instanceof ProviderStopError) {
          stopped = error.reason;
          console.error(JSON.stringify({ slug: job.slug, status: "stopped", reason: error.reason, message: error.message }));
          return;
        }
        failed += 1;
        console.error(JSON.stringify({ slug: job.slug, status: "failed", error: error instanceof Error ? error.message : "Unknown error" }));
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(options.concurrency, pending.length) }, worker));
  console.log(JSON.stringify({ ...summary, succeeded, failed, stopped }, null, 2));
  /* Exit 2 = clean stop on a budget or quota; unfinished jobs stay pending and resume on the next run. */
  if (stopped !== null) process.exitCode = 2;
  else if (failed > 0) process.exitCode = 1;
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Hubpedia batch failed.");
  process.exitCode = 1;
});
