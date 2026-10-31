import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/*
 * Local daily budget for a shared, quota-limited LLM provider.
 *
 * OpenCode Go's quota is shared with other workers of the owner, so the
 * factory keeps its own hard ceiling per JST day (calls and tokens) in a
 * local gitignored file. A call is reserved BEFORE the request is sent, so a
 * crash or a failed request still counts; tokens are added when the response
 * reports them. Nothing here ever sees or stores a credential.
 */

export const OPENCODE_GO_BASE_URL = "https://opencode.ai/inference/go/openai/v1";
export const OPENCODE_GO_MODEL = "deepseek-v4.1-flash";
export const OPENCODE_GO_DEFAULT_DAILY_CALLS = 60;
export const OPENCODE_GO_DEFAULT_DAILY_TOKENS = 600_000;

export type ProviderUsage = { day: string; calls: number; tokens: number };
export type ProviderCaps = { calls: number; tokens: number };

/** Calendar day in Asia/Tokyo as YYYY-MM-DD. */
export function jstDay(now: Date = new Date()): string {
  return new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
}

export function readUsage(path: string, now: Date = new Date()): ProviderUsage {
  const day = jstDay(now);
  if (!existsSync(path)) return { day, calls: 0, tokens: 0 };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<ProviderUsage>;
    if (parsed.day === day && Number.isSafeInteger(parsed.calls) && Number.isSafeInteger(parsed.tokens)) {
      return { day, calls: parsed.calls as number, tokens: parsed.tokens as number };
    }
  } catch {
    /* An unreadable counter must not reset the budget to zero. */
    throw new Error(`Usage counter is unreadable and must be fixed or removed by hand: ${path}`);
  }
  return { day, calls: 0, tokens: 0 };
}

function writeUsage(path: string, usage: ProviderUsage) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(usage)}\n`, "utf8");
  renameSync(temporary, path);
}

export type ReserveResult =
  | { ok: true; usage: ProviderUsage }
  | { ok: false; reason: "daily_call_cap" | "daily_token_cap"; usage: ProviderUsage };

/** Count one call before it is sent. Refuses once either ceiling is reached. */
export function reserveCall(path: string, caps: ProviderCaps, now: Date = new Date()): ReserveResult {
  const usage = readUsage(path, now);
  if (usage.calls >= caps.calls) return { ok: false, reason: "daily_call_cap", usage };
  if (usage.tokens >= caps.tokens) return { ok: false, reason: "daily_token_cap", usage };
  const next = { ...usage, calls: usage.calls + 1 };
  writeUsage(path, next);
  return { ok: true, usage: next };
}

export function recordTokens(path: string, tokens: number, now: Date = new Date()): ProviderUsage {
  const usage = readUsage(path, now);
  const next = { ...usage, tokens: usage.tokens + (Number.isFinite(tokens) && tokens > 0 ? Math.floor(tokens) : 0) };
  writeUsage(path, next);
  return next;
}

export function totalTokens(usage: unknown): number {
  if (!usage || typeof usage !== "object") return 0;
  const record = usage as { total_tokens?: unknown; prompt_tokens?: unknown; completion_tokens?: unknown };
  if (typeof record.total_tokens === "number") return record.total_tokens;
  return (typeof record.prompt_tokens === "number" ? record.prompt_tokens : 0)
    + (typeof record.completion_tokens === "number" ? record.completion_tokens : 0);
}

/** A response that means the provider's quota is spent: stop, never retry. */
export function isUsageLimitResponse(status: number, body: string): boolean {
  if (status === 429) return true;
  return /usage[\s_-]*limit|quota (?:exceeded|exhausted)|rate[\s_-]*limit(?:ed| exceeded)/i.test(body);
}

export function positiveEnvInteger(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error("Daily cap must be a positive integer.");
  return parsed;
}
