export interface AiUsageBudget {
  promptTokens: number;
  completionTokens: number;
  costMicros: number;
}

export function calculateAiCostMicros(promptTokens: number, completionTokens: number, inputRate: number, outputRate: number) {
  return Math.ceil((promptTokens * inputRate + completionTokens * outputRate) / 1_000_000);
}

export function isRetryableAiStatus(status: number) {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

export function assertAiUsageBudget(usage: AiUsageBudget, limits: AiUsageBudget) {
  if (usage.promptTokens >= limits.promptTokens || usage.completionTokens >= limits.completionTokens || usage.costMicros >= limits.costMicros) {
    throw new Error("Encyclopedia AI run budget has been exhausted.");
  }
}

export function getAiRetryDelayMs(attempt: number, baseMs: number) {
  return Math.min(30_000, baseMs * 2 ** attempt);
}
