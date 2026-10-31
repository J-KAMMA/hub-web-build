import { ChainBusyError, ChainExhaustedError, type ChainCall, type ProviderId } from "../provider-chain";
import { planHeadings, type ClassKey, type FactGroup } from "./class-plan";
import type { Fact } from "./facts";
import { articleFromOutput, buildPrompt, SYSTEM_PROMPT } from "./prompt";
import { checkArticle, renderBody, type ArticleVerdict, type ItemNames } from "./verify";

export type Complete = (call: ChainCall) => Promise<{ output: unknown; servedBy: ProviderId | "file"; tokens: number }>;

export type CallLog = { provider: string | null; ok: boolean; error: string | null; tokens: number; latencyMs: number };

export type Generated = {
  verdict: ArticleVerdict | null;
  body: string;
  provider: string | null;
  tokens: number;
  latencyMs: number;
  attempts: number;
  failure: string | null;
  calls: CallLog[];
};

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/** Thrown when every provider is closed for longer than the run is willing to wait. */
export class RunBlockedError extends Error {
  constructor(readonly resumeAt: number | null) {
    super("All providers are closed.");
    this.name = "RunBlockedError";
  }
}

export const MAX_WAIT_MS = 10 * 60_000;

/**
 * One model call per item (a second only when the first answer holds no usable article). A busy chain is waited for in
 * short steps; a closed chain is waited for up to MAX_WAIT_MS, longer than that raises RunBlockedError.
 */
export async function generateItem(
  item: { qid: string; names: ItemNames; facts: readonly Fact[]; classKey: ClassKey; groups: readonly FactGroup[] },
  complete: Complete,
  options: { maxAttempts?: number; maxTokens?: number; now?: () => number } = {},
): Promise<Generated> {
  const now = options.now ?? Date.now;
  const calls: CallLog[] = [];
  const started = now();
  const make = (retryNote?: string): ChainCall => ({ system: SYSTEM_PROMPT, prompt: buildPrompt(item, { retryNote }), maxTokens: options.maxTokens ?? 8192, stage: "extract" });
  let call = make();
  let failure: string | null = null;
  for (let attempt = 1; attempt <= (options.maxAttempts ?? 2); attempt += 1) {
    const t0 = now();
    try {
      let result: Awaited<ReturnType<Complete>> | null = null;
      for (let wait = 0; result === null; wait += 1) {
        try {
          result = await complete(call);
        } catch (error) {
          if (error instanceof ChainBusyError) { await sleep(300 + (wait % 5) * 100); continue; }
          if (error instanceof ChainExhaustedError) {
            const until = error.nextAvailableAt;
            if (until === null || until - now() > MAX_WAIT_MS) throw new RunBlockedError(until);
            await sleep(Math.max(1_000, until - now()));
            continue;
          }
          throw error;
        }
      }
      const latencyMs = now() - t0;
      const article = articleFromOutput(result.output);
      if (!article) {
        calls.push({ provider: result.servedBy, ok: false, error: "no-article-in-output", tokens: result.tokens, latencyMs });
        failure = "no-article-in-output";
        continue;
      }
      calls.push({ provider: result.servedBy, ok: true, error: null, tokens: result.tokens, latencyMs });
      const verdict = checkArticle(article, item.facts, item.names, { headings: planHeadings(item.classKey) });
      /* A monotone article is asked for once more with a note; the second answer is final. */
      if (verdict.rejectReason?.startsWith("style-monotone") && attempt < (options.maxAttempts ?? 2)) {
        failure = verdict.rejectReason;
        call = make("前回の文章は文末が「である」に偏る、または同じ語で始まる文が多すぎた。関連する事実を1文にまとめ、主語・述語・文末を変えて書き直す。");
        continue;
      }
      return { verdict, body: renderBody(verdict.sections), provider: result.servedBy, tokens: result.tokens, latencyMs: now() - started, attempts: attempt, failure: null, calls };
    } catch (error) {
      if (error instanceof RunBlockedError) throw error;
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 160);
      calls.push({ provider: null, ok: false, error: message, tokens: 0, latencyMs: now() - t0 });
      failure = message;
    }
  }
  return { verdict: null, body: "", provider: null, tokens: 0, latencyMs: now() - started, attempts: options.maxAttempts ?? 2, failure, calls };
}
