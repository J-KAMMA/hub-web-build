import "server-only";

import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import { getEncyclopediaAiConfig } from "./config";
import { getDb } from "./db/client";
import { encyclopediaAiCalls } from "./db/schema";
import { assertAiUsageBudget, calculateAiCostMicros, getAiRetryDelayMs, isRetryableAiStatus } from "./ai-policy";

type JsonSchema = z.ZodType<Record<string, unknown>>;

interface ChatCompletionResponse {
  id?: string;
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export async function generateStructured<T extends Record<string, unknown>>(
  pipelineRunId: string,
  purpose: string,
  system: string,
  prompt: string,
  schema: JsonSchema
): Promise<T> {
  const config = getEncyclopediaAiConfig();
  const db = getDb();
  const [runUsage] = await db.select({
    promptTokens: sql<number>`coalesce(sum(${encyclopediaAiCalls.promptTokens}), 0)`,
    completionTokens: sql<number>`coalesce(sum(${encyclopediaAiCalls.completionTokens}), 0)`,
    costMicros: sql<number>`coalesce(sum(${encyclopediaAiCalls.costMicros}), 0)`,
  }).from(encyclopediaAiCalls).where(eq(encyclopediaAiCalls.pipelineRunId, pipelineRunId));
  assertAiUsageBudget({
    promptTokens: Number(runUsage?.promptTokens ?? 0),
    completionTokens: Number(runUsage?.completionTokens ?? 0),
    costMicros: Number(runUsage?.costMicros ?? 0),
  }, {
    promptTokens: config.ENCYCLOPEDIA_AI_MAX_PROMPT_TOKENS_PER_RUN,
    completionTokens: config.ENCYCLOPEDIA_AI_MAX_COMPLETION_TOKENS_PER_RUN,
    costMicros: config.ENCYCLOPEDIA_AI_MAX_COST_MICROS_PER_RUN,
  });
  const [call] = await db.insert(encyclopediaAiCalls).values({
    pipelineRunId,
    provider: config.ENCYCLOPEDIA_AI_PROVIDER,
    model: config.ENCYCLOPEDIA_AI_MODEL,
    purpose,
    status: "running",
    requestMetadata: {
      promptSha256: createHash("sha256").update(`${system}\n${prompt}`).digest("hex"),
      promptCharacters: system.length + prompt.length
    }
  }).returning();

  try {
    let response: Response | undefined;
    let attempt = 0;
    while (attempt <= config.ENCYCLOPEDIA_AI_MAX_RETRIES) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.ENCYCLOPEDIA_AI_TIMEOUT_MS);
      try {
        response = await fetch(`${config.ENCYCLOPEDIA_AI_BASE_URL.replace(/\/$/, "")}/chat/completions`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${config.ENCYCLOPEDIA_AI_API_KEY}`,
            "content-type": "application/json"
          },
          body: JSON.stringify({
            model: config.ENCYCLOPEDIA_AI_MODEL,
            temperature: 0,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: system },
              { role: "user", content: prompt }
            ]
          }),
          signal: controller.signal
        });
        if (response.ok || !isRetryableAiStatus(response.status) || attempt === config.ENCYCLOPEDIA_AI_MAX_RETRIES) break;
      } catch (error) {
        if (attempt === config.ENCYCLOPEDIA_AI_MAX_RETRIES) throw error;
      } finally {
        clearTimeout(timer);
      }
      await new Promise((resolve) => setTimeout(resolve, getAiRetryDelayMs(attempt, config.ENCYCLOPEDIA_AI_RETRY_BASE_MS)));
      attempt += 1;
    }
    if (!response?.ok) throw new Error(`AI provider returned HTTP ${response?.status ?? "unavailable"}.`);
    const payload = await response.json() as ChatCompletionResponse;
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new Error("AI provider returned no structured content.");
    const parsed = schema.parse(JSON.parse(content)) as T;
    const promptTokens = payload.usage?.prompt_tokens ?? 0;
    const completionTokens = payload.usage?.completion_tokens ?? 0;
    const costMicros = calculateAiCostMicros(
      promptTokens,
      completionTokens,
      config.ENCYCLOPEDIA_AI_INPUT_COST_MICROS_PER_MILLION,
      config.ENCYCLOPEDIA_AI_OUTPUT_COST_MICROS_PER_MILLION,
    );
    await db.update(encyclopediaAiCalls).set({
      status: "succeeded",
      completedAt: new Date(),
      promptTokens,
      completionTokens,
      costMicros,
      responseMetadata: { providerRequestId: payload.id ?? null, attempts: attempt + 1 }
    }).where(eq(encyclopediaAiCalls.id, call.id));
    return parsed;
  } catch (error) {
    await db.update(encyclopediaAiCalls).set({
      status: "failed",
      completedAt: new Date(),
      error: {
        code: error instanceof DOMException && error.name === "AbortError" ? "timeout" : "ai_request_failed",
        message: error instanceof Error ? error.message.slice(0, 1000) : "AI request failed."
      }
    }).where(eq(encyclopediaAiCalls.id, call.id));
    throw error;
  }
}
