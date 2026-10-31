import { extractJsonObject, retryDelayMs } from "./llm-batch";
import { isUsageLimitResponse, recordTokens, reserveCall, totalTokens, type ProviderCaps } from "./provider-quota";

/** Raised when the run must stop: a local cap was reached or the provider said its quota is spent. */
export class ProviderStopError extends Error {
  constructor(readonly reason: "daily_call_cap" | "daily_token_cap" | "provider_usage_limit", message: string) {
    super(message);
    this.name = "ProviderStopError";
  }
}

export type BudgetConfig = { usagePath: string; caps: ProviderCaps };

export type CompletionRequest = {
  baseUrl: string;
  apiKey: string;
  model: string;
  system: string;
  prompt: string;
  maxTokens: number;
  /** Extra request headers (never credentials), e.g. the OpenCode session header. */
  extraHeaders?: Record<string, string>;
  /** Extra body fields, e.g. reasoning_effort for a reasoning model that would otherwise spend max_tokens before answering. */
  extraBody?: Record<string, unknown>;
  /** When set, every HTTP call is counted and a usage-limit response stops the run without a retry. */
  budget?: BudgetConfig;
  /** Stop on a usage-limit response without retrying, without a local counter (the caller counts). */
  stopOnLimit?: boolean;
  fetchImpl?: typeof fetch;
  sleepImpl?: (milliseconds: number) => Promise<void>;
};

export async function requestCompletion(request: CompletionRequest): Promise<{ output: unknown; usage: unknown }> {
  const fetchImpl = request.fetchImpl ?? fetch;
  const sleepImpl = request.sleepImpl ?? ((milliseconds) => new Promise<void>((done) => setTimeout(done, milliseconds)));
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    if (request.budget) {
      const reserved = reserveCall(request.budget.usagePath, request.budget.caps);
      if (!reserved.ok) {
        throw new ProviderStopError(reserved.reason, `Local daily budget reached (${reserved.reason}: ${reserved.usage.calls} calls, ${reserved.usage.tokens} tokens today).`);
      }
    }
    const response = await fetchImpl(`${request.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { ...request.extraHeaders, Authorization: `Bearer ${request.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        ...request.extraBody,
        model: request.model,
        messages: [{ role: "system", content: request.system }, { role: "user", content: request.prompt }],
        response_format: { type: "json_object" },
        temperature: 0.2,
        max_tokens: request.maxTokens,
        stream: false,
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (response.ok) {
      const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }>; usage?: unknown };
      if (request.budget) recordTokens(request.budget.usagePath, totalTokens(payload.usage));
      const content = payload.choices?.[0]?.message?.content;
      if (!content) throw new Error("Provider returned no message content.");
      return { output: extractJsonObject(content), usage: payload.usage ?? null };
    }
    if (request.budget || request.stopOnLimit) {
      const body = await response.text().catch(() => "");
      if (isUsageLimitResponse(response.status, body)) {
        throw new ProviderStopError("provider_usage_limit", `Provider reported its usage limit (HTTP ${response.status}); stopping without retry.`);
      }
    }
    const retryable = response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500;
    if (!retryable || attempt === 4) throw new Error(`Provider request failed with HTTP ${response.status}.`);
    await sleepImpl(retryDelayMs(attempt, response.headers.get("retry-after")));
  }
  throw new Error("Provider request exhausted retries.");
}
