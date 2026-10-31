import { z } from "zod";

const positiveInteger = (fallback: number) =>
  z.coerce.number().int().positive().default(fallback);
const nonnegativeInteger = (fallback: number) =>
  z.coerce.number().int().nonnegative().default(fallback);

const localeList = z.string().default("en").transform((value, context) => {
  const locales = [...new Set(value.split(",").map((locale) => locale.trim()).filter(Boolean))];
  if (locales.length > 10 || locales.some((locale) => !/^[a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-[A-Z]{2}|-\d{3})?$/.test(locale))) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Translation locales must be comma-separated BCP 47 language tags." });
    return z.NEVER;
  }
  return locales.filter((locale) => locale !== "ja");
});

const envSchema = z.object({
  ENCYCLOPEDIA_ADMIN_KEY: z.string().min(16),
  ENCYCLOPEDIA_FETCH_TIMEOUT_MS: positiveInteger(15_000),
  ENCYCLOPEDIA_MAX_SOURCE_BYTES: positiveInteger(5_000_000),
  ENCYCLOPEDIA_CHUNK_MAX_TOKENS: positiveInteger(800),
  ENCYCLOPEDIA_CHUNK_OVERLAP_TOKENS: z.coerce.number().int().nonnegative().default(100),
  ENCYCLOPEDIA_EMBEDDING_DIMENSIONS: positiveInteger(1536)
});

const aiEnvSchema = z.object({
  ENCYCLOPEDIA_AI_PROVIDER: z.string().min(1).default("openai-compatible"),
  ENCYCLOPEDIA_AI_BASE_URL: z.string().url().default("https://api.openai.com/v1"),
  ENCYCLOPEDIA_AI_API_KEY: z.string().min(1),
  ENCYCLOPEDIA_AI_MODEL: z.string().min(1),
  ENCYCLOPEDIA_AI_TIMEOUT_MS: positiveInteger(60_000),
  ENCYCLOPEDIA_AI_MAX_RETRIES: nonnegativeInteger(2),
  ENCYCLOPEDIA_AI_RETRY_BASE_MS: positiveInteger(1_000),
  ENCYCLOPEDIA_AI_MAX_PROMPT_TOKENS_PER_RUN: positiveInteger(200_000),
  ENCYCLOPEDIA_AI_MAX_COMPLETION_TOKENS_PER_RUN: positiveInteger(100_000),
  ENCYCLOPEDIA_AI_MAX_COST_MICROS_PER_RUN: positiveInteger(5_000_000),
  ENCYCLOPEDIA_AI_INPUT_COST_MICROS_PER_MILLION: nonnegativeInteger(0),
  ENCYCLOPEDIA_AI_OUTPUT_COST_MICROS_PER_MILLION: nonnegativeInteger(0),
  ENCYCLOPEDIA_AI_CHUNKS_PER_CALL: positiveInteger(8),
  ENCYCLOPEDIA_AI_MAX_CHUNKS_PER_TOPIC: positiveInteger(80),
  ENCYCLOPEDIA_DISCOVERY_MAX_CHUNKS: positiveInteger(16),
  ENCYCLOPEDIA_DISCOVERY_MAX_TOPICS_PER_REFRESH: positiveInteger(2),
  ENCYCLOPEDIA_DISCOVERY_GLOBAL_TOPIC_LIMIT: positiveInteger(500),
  ENCYCLOPEDIA_TRANSLATION_LOCALES: localeList,
  ENCYCLOPEDIA_TRANSLATION_MAX_LOCALES_PER_REFRESH: positiveInteger(3),
  ENCYCLOPEDIA_REFRESH_SCAN_INTERVAL_MS: positiveInteger(300_000),
  ENCYCLOPEDIA_REFRESH_SCAN_LIMIT: positiveInteger(20)
});

export type EncyclopediaConfig = z.infer<typeof envSchema>;
export type EncyclopediaAiConfig = z.infer<typeof aiEnvSchema>;

let cached: EncyclopediaConfig | undefined;
let cachedAi: EncyclopediaAiConfig | undefined;

export function getEncyclopediaConfig(): EncyclopediaConfig {
  cached ??= envSchema.parse(process.env);
  return cached;
}

export function getEncyclopediaAiConfig(): EncyclopediaAiConfig {
  cachedAi ??= aiEnvSchema.parse(process.env);
  return cachedAi;
}

export const EMBEDDING_DIMENSIONS = Number(process.env.ENCYCLOPEDIA_EMBEDDING_DIMENSIONS ?? 1536);
