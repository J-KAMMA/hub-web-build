import { z } from "zod";

export type HubpediaAiJobMode = "expand" | "translate-en" | "extract-claims" | "sourced-article";

export const hubpediaAiJobSchema = z.object({
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  locale: z.string().trim().min(2).max(20),
  system: z.string().trim().min(1),
  prompt: z.string().trim().min(1),
}).strict();

export const hubpediaAiJobFileSchema = z.object({
  version: z.literal(1),
  mode: z.enum(["expand", "translate-en", "extract-claims", "sourced-article"]),
  jobs: z.array(hubpediaAiJobSchema),
}).strict();

export type HubpediaAiJob = z.infer<typeof hubpediaAiJobSchema>;

export function extractJsonObject(content: string): unknown {
  const trimmed = content.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  return JSON.parse(withoutFence);
}

/*
 * A chat CLI has no response_format, so it may wrap the object in prose or
 * add a closing remark. This takes the first balanced top-level JSON object,
 * ignoring braces inside strings, so that surrounding commentary cannot
 * corrupt an otherwise valid result — and still throws when there is none.
 */
export function extractLooseJsonObject(content: string): unknown {
  try {
    return extractJsonObject(content);
  } catch {
    /* Fall through to scanning for an embedded object. */
  }
  const start = content.indexOf("{");
  if (start === -1) throw new SyntaxError("Response contains no JSON object.");
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < content.length; index += 1) {
    const character = content[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return JSON.parse(content.slice(start, index + 1));
    }
  }
  throw new SyntaxError("Response contains no complete JSON object.");
}

export function selectPendingHubpediaJobs(
  jobs: HubpediaAiJob[],
  completedSlugs: ReadonlySet<string>,
  limit: number,
) {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("limit must be a positive integer.");
  return jobs.filter((job) => !completedSlugs.has(job.slug)).slice(0, limit);
}

export function retryDelayMs(attempt: number, retryAfter: string | null) {
  const retryAfterSeconds = retryAfter ? Number(retryAfter) : Number.NaN;
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0) {
    return Math.min(120_000, Math.ceil(retryAfterSeconds * 1_000));
  }
  return Math.min(30_000, 1_000 * (2 ** Math.max(0, attempt - 1)));
}
