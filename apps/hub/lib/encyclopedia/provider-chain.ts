import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { ProviderStopError, requestCompletion } from "./budgeted-request";
import { extractLooseJsonObject } from "./llm-batch";
import { OPENCODE_GO_BASE_URL, OPENCODE_GO_MODEL, totalTokens } from "./provider-quota";
import { jstDay } from "./provider-quota";
import { createHash, randomUUID } from "node:crypto";

/*
 * Provider chain for mass Hubpedia generation (owner decision 2026-10-29):
 *
 * Default order (owner decision 2026-10-30: DeepSeek first, Claude last; HUBPEDIA_CHAIN_ORDER overrides):
 *   0. OpenCode free model first, then Command Code, OpenCode Go, and Claude CLI last.
 *   Claude CLI on the owner's subscription (2026-10-29; concurrency 2; paused until the stated
 *      reset time, else one hour, when the subscription reports a usage limit)
 *   1. OpenCode free model through the CLI (no key; concurrency 1; paused, not
 *      capped, while its usage window is closed)
 *   2. Command Code over HTTP (daily cap; 429 pauses it)
 *   3. OpenCode Go over HTTP (daily cap)
 *
 * A provider is used only while the earlier ones are unavailable for the
 * moment. Limit text never triggers a retry: "window" limits pause the free
 * model until the reset time (Retry-After / stated reset, else one hour),
 * "abusive" blocks it for the rest of the JST day, and a capped provider that
 * reports its own limit is done for the day. Counters live in one local
 * gitignored file; no credential or prompt text is ever written to it.
 */

export type ProviderId = "claude-cli" | "opencode-free" | "command-code" | "opencode-go";
/** Every provider id, for state files. The order of use is CHAIN_ORDER or HUBPEDIA_CHAIN_ORDER. */
export const ALL_PROVIDERS: ProviderId[] = ["claude-cli", "opencode-free", "command-code", "opencode-go"];
export const CHAIN_ORDER: ProviderId[] = ["opencode-free", "command-code", "opencode-go", "claude-cli"];

/** HUBPEDIA_CHAIN_ORDER is a comma list of provider ids; an unknown or repeated id is rejected. Unlisted providers are not used. */
export function resolveChainOrder(env: Record<string, string | undefined> = process.env): ProviderId[] {
  const raw = env.HUBPEDIA_CHAIN_ORDER?.trim();
  if (!raw) return CHAIN_ORDER;
  const ids = raw.split(",").map((id) => id.trim()).filter(Boolean);
  const seen = new Set<string>();
  for (const id of ids) {
    if (!(ALL_PROVIDERS as string[]).includes(id)) throw new Error(`HUBPEDIA_CHAIN_ORDER names an unknown provider "${id}".`);
    if (seen.has(id)) throw new Error(`HUBPEDIA_CHAIN_ORDER repeats "${id}".`);
    seen.add(id);
  }
  if (!ids.length) throw new Error("HUBPEDIA_CHAIN_ORDER is empty.");
  return ids as ProviderId[];
}
export const DEFAULT_DAILY_CAPS: Record<ProviderId, number | null> = {
  "claude-cli": null,
  "opencode-free": null,
  "command-code": 40,
  "opencode-go": 60,
};
export const FREE_DEFAULT_PAUSE_MS = 3_600_000;

type ProviderState = { calls: number; tokens: number; pausedUntil: number; exhaustedToday: boolean };
export type ChainState = { day: string; providers: Record<ProviderId, ProviderState> };

const emptyProvider = (): ProviderState => ({ calls: 0, tokens: 0, pausedUntil: 0, exhaustedToday: false });
const emptyState = (day: string): ChainState => ({
  day,
  providers: { "claude-cli": emptyProvider(), "opencode-free": emptyProvider(), "command-code": emptyProvider(), "opencode-go": emptyProvider() },
});

export function loadChainState(path: string, now: Date): ChainState {
  const day = jstDay(now);
  if (!existsSync(path)) return emptyState(day);
  let parsed: Partial<ChainState>;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<ChainState>;
  } catch {
    throw new Error(`Provider state is unreadable and must be fixed or removed by hand: ${path}`);
  }
  const state = emptyState(day);
  // A pause (a closed usage window) survives midnight; counters and day-long blocks do not.
  const sameDay = parsed.day === day;
  for (const id of ALL_PROVIDERS) {
    const stored = parsed.providers?.[id];
    if (!stored) continue;
    state.providers[id] = {
      calls: sameDay ? Number(stored.calls) || 0 : 0,
      tokens: sameDay ? Number(stored.tokens) || 0 : 0,
      exhaustedToday: sameDay ? stored.exhaustedToday === true : false,
      pausedUntil: Number(stored.pausedUntil) || 0,
    };
  }
  return state;
}

function saveChainState(path: string, state: ChainState) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(state)}\n`, "utf8");
  renameSync(temporary, path);
}

/** Why a provider could not serve a call. */
export class ProviderLimit extends Error {
  constructor(readonly kind: "window" | "abusive" | "daily", message: string, readonly retryAfterMs?: number) {
    super(message);
    this.name = "ProviderLimit";
  }
}

/** Every provider is paused, blocked or capped: stop cleanly, resume later. */
export class ChainExhaustedError extends Error {
  constructor(readonly nextAvailableAt: number | null) {
    super("All providers are paused or exhausted.");
    this.name = "ChainExhaustedError";
  }
}

/**
 * File provider (owner decision 2026-10-30: a person or a Claude Code subagent acts as the model).
 * With no answer yet, the request is written to <dir>/pending/<hash>.json and the call stops like a pause:
 * the chunk stays pending. It subclasses ChainExhaustedError so every caller leaves the row untouched;
 * a batch loop may count it and go on to the next chunk.
 */
export class FilePendingError extends ChainExhaustedError {
  constructor(readonly requestHash: string) {
    super(null);
    this.name = "FilePendingError";
  }
}

export function fileRequestHash(call: ChainCall): string {
  return createHash("sha256").update(JSON.stringify([call.stage ?? "", call.system, call.prompt, call.maxTokens])).digest("hex").slice(0, 32);
}

/** Answers are plain text files; the same JSON extraction and downstream validators apply as for any provider. */
export function completeViaFile(call: ChainCall, directory: string): { output: unknown; servedBy: "file"; tokens: number } {
  const hash = fileRequestHash(call);
  const answer = join(directory, "answers", `${hash}.txt`);
  if (!existsSync(answer)) {
    const pending = join(directory, "pending");
    mkdirSync(pending, { recursive: true });
    writeFileSync(join(pending, `${hash}.json`), JSON.stringify({
      hash, stage: call.stage ?? null, system: call.system, prompt: call.prompt, maxTokens: call.maxTokens,
      expectedFormat: JSON_ONLY_NOTE,
    }, null, 1), "utf8");
    throw new FilePendingError(hash);
  }
  const content = readFileSync(answer, "utf8");
  let output: unknown;
  try {
    output = extractLooseJsonObject(content);
  } catch {
    throw new Error(`File answer ${hash} holds no JSON object.`);
  }
  return { output, servedBy: "file", tokens: 0 };
}
const JSON_ONLY_NOTE = "Write one JSON object only: the RESULT that the prompt's outputContract describes (its own top-level keys), not a copy of the input. No prose, no code fence.";

/** Reads a limit out of CLI or HTTP text. Returns null when the text is not a limit. */
export function classifyLimitText(text: string, status?: number): ProviderLimit | null {
  if (/abusive/i.test(text)) return new ProviderLimit("abusive", "Provider blocked this client for abusive traffic.");
  const limited = status === 429
    || /free usage limit|usage limit|rate[\s_-]*limit|too many requests|quota (?:exceeded|exhausted)|\b429\b/i.test(text);
  if (!limited) return null;
  let retryAfterMs: number | undefined;
  const seconds = /retry[-\s]?after[:"\s]+(\d+)\b/i.exec(text);
  const relative = /(?:try again|reset[s]?|available)\s+(?:in|after)\s+(\d+)\s*(second|minute|hour|day|s\b|m\b|h\b)/i.exec(text);
  if (seconds) retryAfterMs = Number(seconds[1]) * 1_000;
  else if (relative) {
    const unit = relative[2].toLowerCase();
    const scale = unit.startsWith("s") ? 1_000 : unit.startsWith("m") ? 60_000 : unit.startsWith("h") ? 3_600_000 : 86_400_000;
    retryAfterMs = Number(relative[1]) * scale;
  }
  return new ProviderLimit("window", "Provider usage window is closed.", retryAfterMs);
}

/** `stage` lets the Claude provider pick a model per stage; other providers ignore it. */
export type ChainCall = { system: string; prompt: string; maxTokens: number; stage?: "extract" | "judge" | "link" | "compose" | "translate" };
export type AdapterResult = { content: string; tokens: number };
export type Adapter = {
  id: ProviderId;
  /** False when the adapter is not installed or configured; it is skipped without counting. */
  available: () => boolean;
  complete: (call: ChainCall) => Promise<AdapterResult>;
};

export type ChainOptions = {
  statePath: string;
  adapters: Adapter[];
  caps?: Partial<Record<ProviderId, number | null>>;
  now?: () => Date;
  /** Skip a provider whose concurrency gate is full instead of waiting for it; throws ChainBusyError when nothing was free. */
  overflow?: boolean;
};

/* The free model runs one call at a time; the lock is per process. */
const freeGate = { active: 0, max: 1, waiters: [] as Array<() => void> };
/** OpenCode free concurrency: HUBPEDIA_OPENCODE_FREE_CONCURRENCY (1 to 16), default 1. */
export function opencodeFreeConcurrency(env: Record<string, string | undefined> = process.env): number {
  const value = Number(env.HUBPEDIA_OPENCODE_FREE_CONCURRENCY);
  return Number.isInteger(value) && value >= 1 && value <= 16 ? value : 1;
}

/* Claude CLI runs at most two calls at once per process. */
const claudeGate = { active: 0, max: 2, waiters: [] as Array<() => void> };
/** Claude CLI concurrency: HUBPEDIA_CLAUDE_CONCURRENCY (1 to 16), default 2. Read at call time. */
export function claudeConcurrency(env: Record<string, string | undefined> = process.env): number {
  const value = Number(env.HUBPEDIA_CLAUDE_CONCURRENCY);
  return Number.isInteger(value) && value >= 1 && value <= 16 ? value : 2;
}
/** The child env of the claude spawn: never an API credential or base URL, so only the subscription login can serve. */
export function claudeChildEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const copy = { ...env };
  for (const key of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL"]) delete copy[key];
  return copy;
}
/* Command Code runs at most four calls at once per process (owner decision 2026-10-30). */
const commandCodeGate = { active: 0, max: 4, waiters: [] as Array<() => void> };
/** Command Code concurrency: HUBPEDIA_COMMAND_CODE_CONCURRENCY (1 to 32), default 4. Read at call time. */
export function commandCodeConcurrency(env: Record<string, string | undefined> = process.env): number {
  const value = Number(env.HUBPEDIA_COMMAND_CODE_CONCURRENCY);
  return Number.isInteger(value) && value >= 1 && value <= 32 ? value : 4;
}
function gateMax(gate: typeof claudeGate): number {
  return gate === freeGate ? opencodeFreeConcurrency() : gate === commandCodeGate ? commandCodeConcurrency() : claudeConcurrency();
}
/** Overflow mode: a provider whose gate is full is skipped instead of waited for, and the call goes on to the next provider. */
export class ChainBusyError extends Error {
  constructor() {
    super("Every available provider is at its concurrency limit.");
    this.name = "ChainBusyError";
  }
}
async function runLimited<T>(gate: typeof claudeGate, work: () => Promise<T>): Promise<T> {
  gate.max = gateMax(gate);
  while (gate.active >= gate.max) await new Promise<void>((release) => gate.waiters.push(release));
  gate.active += 1;
  try { return await work(); } finally { gate.active -= 1; gate.waiters.shift()?.(); }
}

export async function completeViaChain(call: ChainCall, options: ChainOptions): Promise<{ output: unknown; servedBy: ProviderId | "file"; tokens: number }> {
  const fileDirectory = process.env.HUBPEDIA_FILE_PROVIDER_DIR;
  if (fileDirectory) return completeViaFile(call, fileDirectory); // first in the chain when configured
  const now = options.now ?? (() => new Date());
  const caps = { ...DEFAULT_DAILY_CAPS, ...options.caps };
  let busy = false;
  {
    for (const id of resolveChainOrder()) {
      const adapter = options.adapters.find((candidate) => candidate.id === id);
      if (!adapter || !adapter.available()) continue;
      const attempt = async () => {
        // State is re-read inside the exclusive section so a pause set by another worker is seen.
        const state = loadChainState(options.statePath, now());
        const provider = state.providers[id];
        const cap = caps[id];
        if (provider.exhaustedToday || provider.pausedUntil > now().getTime()) return null;
        if (cap !== null && cap !== undefined && provider.calls >= cap) return null;
        provider.calls += 1; // reserved before the request, so a crash or failure still counts
        saveChainState(options.statePath, state);
        try {
          const result = await adapter.complete(call);
          const after = loadChainState(options.statePath, now());
          after.providers[id].tokens += Math.max(0, Math.floor(result.tokens));
          saveChainState(options.statePath, after);
          return { result, id };
        } catch (error) {
          if (!(error instanceof ProviderLimit)) throw error;
          const after = loadChainState(options.statePath, now());
          if (error.kind === "abusive" || (error.kind === "daily")) after.providers[id].exhaustedToday = true;
          else if (id === "opencode-free" || id === "claude-cli" || id === "command-code") after.providers[id].pausedUntil = now().getTime() + (error.retryAfterMs ?? FREE_DEFAULT_PAUSE_MS);
          else after.providers[id].exhaustedToday = true; // capped providers: a reported limit ends their day
          saveChainState(options.statePath, after);
          return null;
        }
      };
      const gate = id === "opencode-free" ? freeGate : id === "claude-cli" ? claudeGate : id === "command-code" ? commandCodeGate : null;
      if (gate && options.overflow && gate.active >= gateMax(gate)) {
        const peek = loadChainState(options.statePath, now()).providers[id];
        if (!peek.exhaustedToday && peek.pausedUntil <= now().getTime()) busy = true;
        continue;
      }
      const outcome = await (gate ? runLimited(gate, attempt) : attempt());
      if (outcome) {
        let output: unknown;
        try {
          output = extractLooseJsonObject(outcome.result.content);
        } catch {
          throw new Error(`Provider ${id} returned no JSON object.`);
        }
        return { output, servedBy: id, tokens: outcome.result.tokens };
      }
    }
    if (busy) throw new ChainBusyError();
    {
      const state = loadChainState(options.statePath, now());
      const pauses = resolveChainOrder().map((id) => state.providers[id]).filter((p) => !p.exhaustedToday && p.pausedUntil > now().getTime()).map((p) => p.pausedUntil);
      throw new ChainExhaustedError(pauses.length ? Math.min(...pauses) : null);
    }
  }
}

/* ---- adapters ---- */

function stripAnsi(text: string) {
  return text.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "");
}

function runCli(binary: string, args: string[], stdin: string, timeoutMs: number, shell = false, env?: NodeJS.ProcessEnv): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(binary, args, { stdio: ["pipe", "pipe", "pipe"], shell, windowsHide: true, ...(env ? { env } : {}) });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error("CLI provider timed out.")); }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => { clearTimeout(timer); resolvePromise({ stdout: stripAnsi(stdout), stderr: stripAnsi(stderr), code }); });
    child.stdin.end(stdin);
  });
}

const JSON_ONLY = "Return only one JSON object and nothing else: no prose, no code fence.";
/* The job prompt is itself a JSON document (task, outputContract, source text). A CLI agent tends to echo it back,
 * so the input is fenced and the reply is asked for as the RESULT of the contract, never a copy of the input. */
const combine = (call: ChainCall) => [
  "You are a batch worker. Use no tools and read no files.",
  "INSTRUCTIONS:",
  call.system,
  "INPUT (between the markers; do not repeat it):",
  "<<<INPUT",
  call.prompt,
  "INPUT>>>",
  `${JSON_ONLY} It must be the RESULT that the input's outputContract describes (its own top-level keys), not the input itself.`,
].join("\n");
const estimateTokens = (call: ChainCall, content: string) => Math.ceil((combine(call).length + content.length) / 3);

async function cliComplete(binary: string, args: string[], call: ChainCall): Promise<AdapterResult> {
  const result = await runCli(binary, args, combine(call), 300_000);
  // Limit text may appear in either stream, and a limit can come with a zero exit code.
  const limit = classifyLimitText(`${result.stdout}\n${result.stderr}`.slice(0, 4_000));
  if (limit && (result.code !== 0 || result.stdout.trim().length < 400)) throw limit;
  if (result.code !== 0) throw new Error(`CLI provider exited with code ${result.code}.`);
  const content = result.stdout.trim();
  if (!content) throw new Error("CLI provider returned no content.");
  return { content, tokens: estimateTokens(call, content) };
}

/* Node refuses to spawn .cmd shims without a shell, so on Windows the real executable is used. */
function opencodeBinary() {
  if (process.env.HUBPEDIA_OPENCODE_BIN) return process.env.HUBPEDIA_OPENCODE_BIN;
  if (process.platform === "win32" && process.env.APPDATA) {
    const exe = join(process.env.APPDATA, "npm", "node_modules", "opencode-ai", "bin", "opencode.exe");
    if (existsSync(exe)) return exe;
  }
  return "opencode";
}

export function opencodeFreeAdapter(): Adapter {
  return {
    id: "opencode-free",
    available: () => process.env.HUBPEDIA_OPENCODE_FREE !== "off",
    complete: (call) => cliComplete(opencodeBinary(), ["run", "--pure", "-m", "opencode/deepseek-v4.1-flash-free"], call),
  };
}

export const COMMAND_CODE_BASE_URL = "https://api.commandcode.ai/provider/v1";
export const COMMAND_CODE_DEFAULT_MODEL = "deepseek/deepseek-v4.1-flash";

/**
 * Command Code over its OpenAI-compatible HTTP API (owner decision 2026-10-30). The key is read from COMMAND_CODE_API_KEY
 * only and is sent only in the Authorization header; neither the key nor any header is logged or put in an error.
 * 429 pauses the provider (Retry-After honoured), 402 and quota text end its day, anything else is an ordinary failure.
 */
export function commandCodeAdapter(options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {}): Adapter {
  return {
    id: "command-code",
    available: () => Boolean(process.env.COMMAND_CODE_API_KEY),
    complete: async (call) => {
      const fetchImpl = options.fetchImpl ?? fetch;
      const response = await fetchImpl(`${COMMAND_CODE_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.COMMAND_CODE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: process.env.HUBPEDIA_COMMAND_CODE_MODEL || COMMAND_CODE_DEFAULT_MODEL,
          messages: [{ role: "system", content: call.system }, { role: "user", content: call.prompt }],
          temperature: 0.2,
          max_tokens: call.maxTokens,
          stream: false,
        }),
        signal: AbortSignal.timeout(options.timeoutMs ?? 300_000),
      });
      if (!response.ok) {
        const body = (await response.text().catch(() => "")).slice(0, 500);
        if (response.status === 429) {
          const header = Number(response.headers.get("retry-after"));
          throw new ProviderLimit("window", "Command Code rate limit.", Number.isFinite(header) && header > 0 ? header * 1_000 : undefined);
        }
        if (response.status === 402 || /quota|insufficient|credit|billing/i.test(body)) throw new ProviderLimit("daily", "Command Code quota is spent.");
        throw new Error(`Command Code returned HTTP ${response.status}.`);
      }
      const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }>; usage?: unknown };
      const content = payload.choices?.[0]?.message?.content?.trim();
      if (!content) throw new Error("Command Code returned no content.");
      return { content, tokens: totalTokens(payload.usage) || estimateTokens(call, content) };
    },
  };
}

/** OpenCode Go over HTTP. The key is read from OPENCODE_API_KEY only. A reported limit ends its day. */
export function opencodeGoAdapter(maxTokensCeiling = 8_192): Adapter {
  const session = randomUUID();
  return {
    id: "opencode-go",
    available: () => Boolean(process.env.OPENCODE_API_KEY),
    complete: async (call) => {
      try {
        const result = await requestCompletion({
          baseUrl: OPENCODE_GO_BASE_URL,
          apiKey: process.env.OPENCODE_API_KEY as string,
          model: OPENCODE_GO_MODEL,
          system: call.system,
          prompt: call.prompt,
          maxTokens: Math.min(call.maxTokens, maxTokensCeiling),
          extraHeaders: { "x-opencode-session": session },
          extraBody: { reasoning_effort: "low" },
          stopOnLimit: true,
        });
        return { content: JSON.stringify(result.output), tokens: totalTokens(result.usage) };
      } catch (error) {
        if (error instanceof ProviderStopError) throw new ProviderLimit("daily", error.message);
        throw error;
      }
    },
  };
}

/* ---- Claude CLI (owner's subscription) ---- */

const CLAUDE_STAGE_DEFAULTS: Record<NonNullable<ChainCall["stage"]>, string> = {
  extract: "sonnet", judge: "sonnet", link: "sonnet", translate: "sonnet", compose: "opus",
};

/** The model is always explicit. HUBPEDIA_CLAUDE_MODEL_<STAGE> overrides a stage; HUBPEDIA_CLAUDE_MODEL overrides all. */
export function claudeModelFor(stage: ChainCall["stage"], env: NodeJS.ProcessEnv = process.env): string {
  const chosen = (stage && env[`HUBPEDIA_CLAUDE_MODEL_${stage.toUpperCase()}`]) || env.HUBPEDIA_CLAUDE_MODEL || CLAUDE_STAGE_DEFAULTS[stage ?? "extract"] || "sonnet";
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(chosen)) throw new Error("Claude model name must be a plain model name such as opus or sonnet.");
  return chosen;
}

/** Reads a usage-limit message of the claude CLI. Returns the pause in ms (stated reset, else one hour), or null. */
export function classifyClaudeLimit(text: string, nowMs: number): ProviderLimit | null {
  /* A logged-out CLI cannot serve until a person signs in: pause it for six hours and let the next provider work. */
  if (/failed to authenticate|oauth session expired|not logged in|please run .login|invalid api key/i.test(text)) return new ProviderLimit("window", "Claude CLI is not signed in.", 6 * 3_600_000);
  if (!/usage limit|hit your limit|limit reached|rate[\s_-]*limit|too many requests|\b429\b|overloaded_error|\bresets? (?:at )?\d/i.test(text)) return null;
  const epoch = /limit reached\s*\|\s*(\d{10})\b/i.exec(text);
  if (epoch) return new ProviderLimit("window", "Claude usage window is closed.", Math.max(60_000, Number(epoch[1]) * 1_000 - nowMs));
  const clock = /resets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(text);
  if (clock) {
    let hour = Number(clock[1]);
    if (clock[3]) hour = (hour % 12) + (clock[3].toLowerCase() === "pm" ? 12 : 0);
    if (hour < 24) {
      const at = new Date(nowMs);
      at.setHours(hour, Number(clock[2] ?? 0), 0, 0);
      if (at.getTime() <= nowMs) at.setDate(at.getDate() + 1);
      return new ProviderLimit("window", "Claude usage window is closed.", at.getTime() - nowMs);
    }
  }
  const relative = classifyLimitText(text);
  return new ProviderLimit("window", "Claude usage window is closed.", relative?.retryAfterMs);
}

type CliRunner = typeof runCli;

export function claudeCliAdapter(options: { run?: CliRunner; binary?: string; now?: () => number; timeoutMs?: number } = {}): Adapter {
  const run = options.run ?? runCli;
  const binary = options.binary ?? process.env.HUBPEDIA_CLAUDE_BIN ?? "claude";
  const now = options.now ?? Date.now;
  return {
    id: "claude-cli",
    available: () => process.env.HUBPEDIA_CLAUDE_CLI !== "off",
    complete: async (call) => {
      const model = claudeModelFor(call.stage);
      /* Arguments are a fixed list; the prompt (all job content) goes through stdin. */
      const args = ["-p", "--model", model, "--no-session-persistence", "--disallowedTools", "Task,Agent,Bash,Write,Edit,WebSearch,WebFetch", "--output-format", "text"];
      const result = await run(binary, args, combine(call), options.timeoutMs ?? 600_000, process.platform === "win32", claudeChildEnv());
      const limit = classifyClaudeLimit(`${result.stdout}
${result.stderr}`.slice(0, 4_000), now());
      if (limit && (result.code !== 0 || result.stdout.trim().length < 400)) throw limit;
      if (result.code !== 0) throw new Error(`Claude CLI exited with code ${result.code}.`);
      const content = result.stdout.trim();
      if (!content) throw new Error("Claude CLI returned no content.");
      return { content, tokens: estimateTokens(call, content) };
    },
  };
}
